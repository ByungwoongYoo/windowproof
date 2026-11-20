export const demoOrigins = Object.freeze({
  desk: "http://127.0.0.1:8765",
  listings: "http://localhost:8766",
  rules: "http://[::1]:8767",
})

export const peerDefinitions = Object.freeze({
  listings: {
    name: "listing_evidence",
    title: "Listing archive",
    purpose: "Read recorded dates and eligibility from public event listings.",
  },
  rules: {
    name: "rules_evidence",
    title: "Rules archive",
    purpose: "Read recorded dates and eligibility from official rules and linked forms.",
  },
})
