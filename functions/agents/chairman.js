// Agent: Chairman
// Role: Leads the AGMX meetings, sets agenda, manages speaker queue

export const config = {
  runtime: "nodejs22",
  memory: 2048,
  timeout: 30,
}

export default async function handler(req, res) {
  try {
    const { prompt, meetingContext } = req.body || {}
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" })
    }
    
    // Build agent prompt with context
    const agentPrompt = `You are the CHAIRMAN agent for AGMX governance system.

Current meeting context: ${meetingContext || 'No specific context'}

Your responsibilities:
- Call meeting to order and set agenda
- Manage speaker queue
- Ensure quorum requirements are met
- Oversee voting procedures
- Maintain audit trail of decisions

User prompt: ${prompt}

Respond with a JSON object containing:
- response: your agent's analysis/recommendation
- action: any suggested action (e.g., "call_vote", "move_speaker", "check_quorum")
- confidence: number 0-1 how confident you are

Keep responses concise and structured for machine consumption.`
    
    // Call LLM API - in production, use your preferred provider
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
      agent: 'chairman',
      success: true,
    })
    
  } catch (error) {
    console.error('Chairman agent error:', error)
    res.status(500).json({
      error: error.message,
      agent: 'chairman',
      success: false,
    })
  }
}
