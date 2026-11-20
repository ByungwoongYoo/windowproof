let currentAudit = null
let evidenceReads = 0

export function setCurrentAudit(audit) {
  currentAudit = audit
}

export function comparisonReadCount() {
  return evidenceReads
}

export function registerActions(actions) {
  actions.register({
    name: "read_comparison",
    description: "Read the current paired archive comparison, including source links and calculated Seoul times.",
    effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      evidenceReads += 1
      return currentAudit ?? { status: "not_ready" }
    },
  })
}
