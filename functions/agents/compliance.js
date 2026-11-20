// Agent: Compliance
// Role: Checks regulations, validates compliance, flags issues

export const config = {
  runtime: "nodejs22",
  memory: 2048,
  timeout: 30,
}

export default async function handler(req, res) {
  try {
    const { prompt, regulationsContext } = req.body || {}
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" })
    }
    
    const agentPrompt = `You are the COMPLIANCE agent for AGMX governance system.

Regulatory context: ${regulationsContext || 'General AGMX compliance'}

Your responsibilities:
- Review proposals against applicable regulations
- Identify compliance risks and violations
- Suggest remediation steps
- Check audit trail integrity
- Recommend policy updates

User prompt: ${prompt}

Respond with JSON containing:
- response: compliance analysis
- risks: array of identified risk items (or empty array)
- recommendations: array of recommended actions
- priority: "low" | "medium" | "high" | "critical"

Markdown format acceptable for risk descriptions.`
    
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
      agent: 'compliance',
      success: true,
    })
    
  } catch (error) {
    console.error('Compliance agent error:', error)
    res.status(500).json({
      error: error.message,
      agent: 'compliance',
      success: false,
    })
  }
}
