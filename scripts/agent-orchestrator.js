// Agent Orchestrator for AGMX
// Distributes work to Vercel Functions agents
// Runs on laptop with limited hardware (i5-3320M, 15GB RAM)
// Offloads LLM execution to Vercel platform

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// Your 6 agents - matching the AGMX copilot structure
const AGENTS = [
  'chairman',
  'secretary', 
  'compliance',
  'planner',
  'nomination',
  'questions'
]

// Concurrency limit for your 4-thread CPU
const MAX_CONCURRENT = 2
let activeAgents = 0

/**
 * Run a single agent function via Vercel dev
 * @param {string} agentName - Name of the agent (matches filename)
 * @param {string} prompt - The prompt/instruction for the agent
 * @param {object} context - Additional context (meeting, audit, etc.)
 * @returns {Promise<object>} - Agent response
 */
async function runAgent(agentName, prompt, context = {}) {
  // Enforce concurrency limit
  while (activeAgents >= MAX_CONCURRENT) {
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  activeAgents++
  
  try {
    return new Promise((resolve, reject) => {
      const vercelProc = spawn('node', ['-e', `
const http = require('http');
const url = require('url');

// Simulate Vercel function call
const agentModule = require('./functions/agents/${agentName}.js')
const handler = agentModule.default || agentModule

// Create a mock request object
const req = {
  body: ${JSON.stringify({ prompt, ...context })},
  method: 'POST',
  url: '/api/agent'
}

// Create a mock response object
const res = {
  statusCode: 200,
  json: function(result) {
    console.log('AGENT RESPONSE:', agentName, result)
    process.exit(0)
  },
  status: function(code) {
    this.statusCode = code
    return this
  },
  send: function(code) {
    this.statusCode = code
    process.exit(0)
  }
}

// Call the handler
handler(req, res).catch(err => {
  console.error('Agent error:', err)
  process.exit(1)
})
      `}, {
        env: { 
          ...process.env,
          PROMPT: prompt,
          ...context 
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      
      let output = ''
      let error = ''
      
      vercelProc.stdout.on('data', (data) => {
        output += data.toString()
      })
      
      vercelProc.stderr.on('data', (data) => {
        error += data.toString()
      })
      
      vercelProc.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output.trim())
            resolve(result)
          } catch (e) {
            resolve({ agent: agentName, rawOutput: output, error: 'Invalid JSON response' })
          }
        } else {
          reject(new Error(error || `Agent ${agentName} exited with code ${code}`))
        }
      })
      
      // Timeout after 60 seconds
      setTimeout(() => {
        vercelProc.kill()
        reject(new Error(`Agent ${agentName} timed out after 60s`))
      }, 60000)
    })
  } finally {
    activeAgents--
  }
}

/**
 * Orchestrate all 6 agents with given prompts
 * @param {Array<object>} prompts - Array of {agent, prompt} objects or just prompts in order
 * @returns {Promise<Array>} - Array of agent results
 */
async function orchestrate(prompts) {
  // Normalize prompts to array of {agent, prompt} objects
  const agentPrompts = AGENTS.map((agent, i) => {
    if (typeof prompts[i] === 'string') {
      return { agent, prompt: prompts[i] }
    }
    return { agent: prompts[i].agent, prompt: prompts[i].prompt || prompts[i].text }
  })
  
  // Run agents with concurrency control
  const results = []
  const executing = []
  
  for (const { agent, prompt } of agentPrompts) {
    // Wait for a slot if at capacity
    if (executing.length >= MAX_CONCURRENT) {
      const completed = await new Promise(resolve => {
        setTimeout(() => {
          // Find first completed agent
          for (let i = 0; i < executing.length; i++) {
            if (executing[i].done) {
              const result = executing[i].result
              executing.splice(i, 1)
              resolve(result)
              return
            }
          }
          // Not done yet, try again
          resolve(executing[executing.length - 1])
        }, 500)
      })
      results.push(completed)
    }
    
    const result = await runAgent(agent, prompt)
    results.push(result)
  }
  
  // Wait for any remaining agents
  while (executing.length > 0) {
    const completed = await new Promise(resolve => {
      setTimeout(() => {
        for (let i = 0; i < executing.length; i++) {
          if (executing[i].done) {
            const result = executing[i].result
            executing.splice(i, 1)
            resolve(result)
            return
          }
        }
        resolve(null)
      }, 500)
    })
    if (completed) results.push(completed)
  }
  
  return results
}

// Export for use in other scripts
module.exports = {
  AGENTS,
  MAX_CONCURRENT,
  runAgent,
  orchestrate,
  orchestrateConcurrent: async (prompts) => {
    // Run agents limited by MAX_CONCURRENT
    const results = []
    const queue = [...prompts]
    
    while (queue.length > 0) {
      // Start up to MAX_CONCURRENT agents
      const batch = queue.splice(0, MAX_CONCURRENT)
      const batchPromises = batch.map(item => runAgent(item.agent, item.prompt))
      
      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
    }
    
    return results
  }
}

// Example usage (commented out)
// const prompts = AGENTS.map((agent, i) => ({
//   agent,
//   prompt: `You are the ${agent} agent for AGMX. Process this: "Sample agenda item for AGMX meeting."`
// }))
// orchestrate(prompts).then(console.log).catch(console.error)