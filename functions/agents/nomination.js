// Agent: Nomination
// Role: Candidate evaluation, nomination process, voting

export const config = {
  runtime: "nodejs22",
  memory: 2048,
  timeout: 30,
}

export default async function handler(req, res) {
  try {
    const { prompt, electionContext } = req.body || {}
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" })
    }
    
    const agentPrompt = `You are the NOMINATION agent for AGMX governance system.

Election context: ${electionContext || 'General nomination process'}

Your responsibilities:
- Evaluate candidate eligibility and qualifications
- Manage nomination process
- Oversee voting procedures and quorum
- Validate voting results
- Maintain fairness and transparency

User prompt: ${prompt}

Respond with JSON containing:
- response: nomination analysis
- eligibleCandidates: array of qualified candidates (or details)
- votingRecommendations: suggested voting approach
- concerns: any transparency or fairness concerns
- nextSteps: recommended actions

Structure for machine verification.`
    
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
      agent: 'nomination',
      success: true,
    })
    
  } catch (error) {
    console.error('Nomination agent error:', error)
    res.status(500).json({
      error: error.message,
      agent: 'nomination',
      success: false,
    })
  }
}
