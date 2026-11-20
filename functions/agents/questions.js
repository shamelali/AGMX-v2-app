// Agent: Questions
// Role: Question management, Q&A, attendee inquiries

export const config = {
  runtime: "nodejs22",
  memory: 2048,
  timeout: 30,
}

export default async function handler(req, res) {
  try {
    const { prompt, meetingContext, questionHistory } = req.body || {}
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" })
    }
    
    const agentPrompt = `You are the QUESTIONS agent for AGMX governance system.

Meeting context: ${meetingContext || 'General meeting context'}
Previous question history: ${questionHistory || 'None recorded'}

Your responsibilities:
- Manage attendee questions and speaker queue
- Prioritize questions based on relevance and time
- Filter duplicate or out-of-scope questions
- Track question responses and resolutions
- Maintain decorum and time limits

User prompt: ${prompt}

Respond with JSON containing:
- response: question analysis and handling
- action: "add_to_queue", "prioritize", "respond", "move_on"
- queuePosition: number if adding to queue
- followUpNeeded: boolean
- summary: brief summary of question handling

Machine-readable format.`
    
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
      agent: 'questions',
      success: true,
    })
    
  } catch (error) {
    console.error('Questions agent error:', error)
    res.status(500).json({
      error: error.message,
      agent: 'questions',
      success: false,
    })
  }
}
