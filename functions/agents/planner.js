// Agent: Planner
// Role: Strategic planning, roadmap, resource allocation

export const config = {
  runtime: "nodejs22",
  memory: 2048,
  timeout: 30,
}

export default async function handler(req, res) {
  try {
    const { prompt, strategicContext } = req.body || {}
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" })
    }
    
    const agentPrompt = `You are the PLANNER agent for AGMX governance system.

Strategic context: ${strategicContext || 'General AGMX planning horizon'}

Your responsibilities:
- Develop long-term roadmaps
- Prioritize initiatives and features
- Allocate resources and budget
- Assess risks and opportunities
- Define milestones and success metrics

User prompt: ${prompt}

Respond with structured JSON containing:
- response: planning analysis
- priorities: ranked list of initiatives
- timeline: suggested timeline estimates
- resources: needed resources/team assignments
- metrics: success measurements

Keep strategic but actionable.`
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: agentPrompt }],
        temperature: 0.3,
      }),
    })
    
    const data = await response.json()
    
    res.json({
      response: data.choices[0].message.content,
      agent: 'planner',
      success: true,
    })
    
  } catch (error) {
    console.error('Planner agent error:', error)
    res.status(500).json({
      error: error.message,
      agent: 'planner',
      success: false,
    })
  }
}
