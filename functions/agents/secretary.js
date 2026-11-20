// Agent: Secretary
// Role: Records minutes, manages documents, handles signatures

export const config = {
  runtime: "nodejs22",
  memory: 2048,
  timeout: 30,
}

export default async function handler(req, res) {
  try {
    const { prompt, meetingContext, auditTrail } = req.body || {}
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" })
    }
    
    const agentPrompt = `You are the SECRETARY agent for AGMX governance system.

Current context: ${meetingContext || 'No specific context'}
Audit trail status: ${auditTrail || 'Not provided'}

Your responsibilities:
- Record meeting minutes accurately
- Manage document signatures and verification
- Maintain hash chain integrity
- Track attendance and quorum
- Export evidence packages when requested

User prompt: ${prompt}

Respond with structured JSON containing:
- response: your analysis/records
- action: suggested actions (e.g., "record_minutes", "verify_signature", "check_audit")
- documentRefs: any document references or hashes needed

Format for machine consumption.`
    
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
      agent: 'secretary',
      success: true,
    })
    
  } catch (error) {
    console.error('Secretary agent error:', error)
    res.status(500).json({
      error: error.message,
      agent: 'secretary',
      success: false,
    })
  }
}
