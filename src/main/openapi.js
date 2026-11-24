const toolRegistry = require('./tools');

function generateOpenApiSpec(baseUrl = 'http://localhost:3721') {
  const schemas = toolRegistry.getSchemas();

  const paths = {
    '/api/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check and server status',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    workspace: { type: 'string' },
                    tools_count: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  // Generate an endpoint for each tool
  for (const tool of schemas) {
    const route = `/api/tools/${tool.name}`;
    paths[route] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        description: `${tool.description}. Executed within the active local workspace.`,
        requestBody: {
          required: tool.inputSchema?.required && tool.inputSchema.required.length > 0,
          content: {
            'application/json': {
              schema: tool.inputSchema || { type: 'object' }
            }
          }
        },
        responses: {
          '200': {
            description: `Result from ${tool.name}`,
            content: {
              'application/json': {
                schema: {
                  type: 'object'
                }
              }
            }
          },
          '400': { description: 'Bad Request / Invalid parameters' },
          '401': { description: 'Unauthorized - invalid API token' },
          '403': { description: 'Permission Denied / User rejected action' },
          '500': { description: 'Internal Execution Error' }
        }
      }
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'OmniDev Studio MCP API',
      version: '1.0.0',
      description: 'Supercharged local development assistant. Provides full file read/write, terminal execution with async job_id tracking, SQLite database capabilities, Git tools, and workspace isolation.'
    },
    servers: [
      {
        url: baseUrl,
        description: 'OmniDev Live Tunnel / Local Server'
      }
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT or API Key',
          description: 'Enter your OmniDev Secret Token provided in the desktop app'
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  };
}

module.exports = { generateOpenApiSpec };
