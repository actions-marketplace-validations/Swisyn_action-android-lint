import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'
import {parseString} from 'xml2js'

class CheckstyleObject {
  file: string
  line: string
  column: string
  severity: string
  message: string

  constructor(
    file: string,
    line: string,
    column: string,
    severity: string,
    message: string
  ) {
    this.file = file
    this.line = line
    this.column = column
    this.severity = severity
    this.message = message
  }
}

const entityMap = new Map<string, string>(
  Object.entries({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  })
)

async function run(): Promise<void> {
  try {
    core.startGroup(`📘 Reading input values`)

    const gitServerUrl: string = process.env[`GITHUB_SERVER_URL`] || ''
    const gitRepository: string = process.env[`GITHUB_SERVER_URL`] || ''
    const runnerWorkspace: string = process.env[`GITHUB_REPOSITORY`] || ''
    const repoName: string[] = gitRepository.split('/')
    let organisationName = ''
    if (repoName.length >= 1) organisationName = repoName[1]
    const gitWorkspace = process.env[`GITHUB_WORKSPACE`] || ''

    const lintXmlFile = core.getInput('lint_xml_file') || ''

    if (!lintXmlFile) {
      core.setFailed('❌ No lint file specified')
      return
    }

    const xmlFileDestination = path.join(gitWorkspace, lintXmlFile)

    if (!fs.existsSync(xmlFileDestination)) {
      core.setFailed(
        `❌ Invalid file specified. Specified path is ${fs.realpathSync(
          lintXmlFile
        )}`
      )
      return
    }

    core.debug(
      `runnerWorkspace is ${runnerWorkspace} and repoName is ${repoName} exists? ${fs.existsSync(
        path.join(runnerWorkspace, lintXmlFile)
      )} and gitWorkspace is ${gitWorkspace} exists? ${fs.existsSync(
        xmlFileDestination
      )} organisationName = ${organisationName}, gitServerUrl = ${gitServerUrl}/${runnerWorkspace}`
    )
    core.endGroup()

    core.startGroup(`📦 Process lint report content`)

    const lintXmlFileContents = fs.readFileSync(xmlFileDestination, 'utf8')

    parseString(lintXmlFileContents, function (error, result) {
      if (error) {
        core.setFailed(`❌ There was an error when parsing: ${error}`)
      } else {
        let xml = '\n<?xml version="1.0" encoding="utf-8"?>'
        xml += '\n<checkstyle version="8.0">'

        let issuesCount = 0
        try {
          issuesCount = result['issues']['issue'].length
        } catch (e) {
          issuesCount = 0
        }

        core.info(`Retrieved ${issuesCount} issues to process.`)

        const checkstyleData: CheckstyleObject[] = []

        for (let i = 0; i < issuesCount; i++) {
          const currentObject = result['issues']['issue'][i]
          for (const key in currentObject) {
            if (currentObject.hasOwnProperty(key)) {
              const issue = currentObject['$']
              const severity = escape(issue.severity).toLowerCase()
              if (severity === 'error') {
                const location = currentObject['location'][0]['$']
                const file = escape(
                  location.file.replace(
                    `${runnerWorkspace}/${organisationName}`,
                    ''
                  )
                )
                const line = escape(location.line)
                const column = escape(location.column)
                const message = escape_html(`${issue.id}: ${issue.message}`)

                checkstyleData.push(
                  new CheckstyleObject(file, line, column, severity, message)
                )
              }
            }
          }
        }

        const grouped = checkstyleData.reduce(function (r, a) {
          r[a.file] = r[a.file] || []
          r[a.file].push(a)
          return r
        }, Object.create(null))

        const groupedKeys = Object.keys(grouped)
        for (const key of groupedKeys) {
          xml += `\n<file name="${key}">`
          for (let j = 0; j < groupedKeys.length; ++j) {
            const issue = grouped[key][j] as CheckstyleObject
            xml += `\n<error`
            if (issue.line !== 'undefined') {
              xml += ` line="${issue.line}"`
            }
            if (issue.column !== 'undefined') {
              xml += ` column="${issue.column}"`
            }
            xml += ` severity="${issue.severity}"`
            xml += ` message="${issue.message}" />`
          }

          xml += '\n</file>'
        }

        xml += '\n</checkstyle>'

        const destinationCheckstylePath = path.join(
          gitWorkspace,
          'checkstyle.xml'
        )
        fs.writeFileSync(destinationCheckstylePath, xml)

        core.startGroup(
          `🚀 Checkstyle output is ready to be served on ${destinationCheckstylePath}`
        )
        core.setOutput('output_checkstyle_file', destinationCheckstylePath)
        core.endGroup()
      }
    })
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

export function escape_html(source: string): string {
  return String(source).replace(/[&<>"'/]/g, (s: string) => entityMap.get(s)!)
}

run()
