export const policy = {
  maxSteps: 6,
  overallTimeoutMs: 25_000,
  retryOnNetworkErrors: 1,
  truncation: {
    toolResultMaxChars: 1200,
    toolSummaryMaxChars: 300
  },
  hardStops: {
    captchaDetected: "captcha_detected",
    invalidDomain: "invalid_domain"
  },
  // Minimal routing hints (optional; model still chooses tools)
  hints: (goal) => ({
    preferTimeParse: /tomorrow|next|in \d+ (min|hour|hours)|am|pm/i.test(goal),
    preferWeb: /(login|log in|sign in|dashboard|website|url)/i.test(goal)
  }),
  // OPTIONAL: guardrails for send_email tool
  email: {
    // Comma-separated env: EMAIL_DOMAIN_ALLOW=example.com,mycompany.org
    allowDomains: (process.env.EMAIL_DOMAIN_ALLOW || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    maxPerMinute: Number(process.env.EMAIL_MAX_PER_MIN || 60)
  }
};
