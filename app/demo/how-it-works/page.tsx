import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "Agents propose",
    description: "Independent proposer agents submit target allocations with a rationale and a USDC bond. A status-quo proposal is always available.",
    detail: "Ideas are candidates, not instructions.",
    tone: "step-violet",
    icon: "✳",
  },
  {
    number: "02",
    title: "Forecasters evaluate",
    description: "A separate market is created for each proposal. Forecasters deposit once and can claim credits independently in every market.",
    detail: "One deposit · every proposal market.",
    tone: "step-green",
    icon: "↗",
  },
  {
    number: "03",
    title: "The market selects",
    description: "At the decision boundary, the protocol compares final-window time-weighted prices. A proposal must beat the status quo by a minimum margin.",
    detail: "If the signal is weak, the vault holds.",
    tone: "step-amber",
    icon: "⌁",
  },
  {
    number: "04",
    title: "The vault executes and settles",
    description: "The selected allocation guides the vault for the next period. Once its return is evaluated, only the winning market settles.",
    detail: "Losing markets are voided.",
    tone: "step-green",
    icon: "◈",
  },
];

export default function HowItWorksPage() {
  return (
    <main className="demo-page page-shell">
      <header className="demo-page-heading demo-page-heading-primary">
        <div><span className="eyebrow">THE WAVEFUND MECHANISM</span><h1>A market becomes the manager.</h1></div>
        <p>Wavefund separates idea generation from capital allocation: agents suggest paths, an open market evaluates them, and the vault follows only when the signal clears its guardrails.</p>
      </header>
      <section className="mechanism-route-grid">
        {steps.map((step) => (
          <article className="step-card" key={step.number}>
            <span className="step-number">{step.number}</span>
            <span className={`step-icon ${step.tone}`} aria-hidden="true">{step.icon}</span>
            <h2>{step.title}</h2>
            <p>{step.description}</p>
            <span className="step-tag">{step.detail}</span>
          </article>
        ))}
      </section>
      <section className="mechanism-note mechanism-route-note">
        <span aria-hidden="true">✓</span>
        <p><strong>Separate pools of money.</strong> Vault deposits belong to fund depositors. Forecast collateral belongs to forecasters. Quantum credits let one deposit back claims in multiple proposal markets without multiplying the trader's deposit.</p>
        <Link href="/demo/markets">Explore decision markets <span aria-hidden="true">→</span></Link>
      </section>
      <p className="demo-page-disclaimer">This demo simulates the proposed accounting and round lifecycle. It does not execute transactions or connect to Arc, Uniswap v4, or live oracles.</p>
    </main>
  );
}
