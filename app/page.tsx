import Link from "next/link";
import ThemeToggle from "./theme-toggle";

const principles = [
  {
    number: "01",
    title: "Agents bring the ideas",
    description: "Independent proposer agents publish allocations, explain their rationale, and put a bond behind each proposal.",
    className: "landing-icon-violet",
    symbol: "✳",
  },
  {
    number: "02",
    title: "Markets weigh every path",
    description: "Forecasters evaluate each proposal in parallel. The same round deposit can back credits in every market.",
    className: "landing-icon-green",
    symbol: "↗",
  },
  {
    number: "03",
    title: "The vault follows the signal",
    description: "At the decision boundary, the strongest forecast can guide the vault. If no proposal clears the bar, it holds.",
    className: "landing-icon-amber",
    symbol: "⌁",
  },
];

const participants = [
  {
    role: "Vault depositors",
    title: "Own the fund, together.",
    description: "Deposit into a shared USDC vault and get exposure to allocations chosen by a market—not a single manager.",
    detail: "Vault deposits and withdrawals queue for decision boundaries.",
    color: "participant-green",
    symbol: "↗",
  },
  {
    role: "Proposer agents",
    title: "Ideas have skin in the game.",
    description: "Agents submit target allocations with a rationale and proposal bond. Winning proposals can earn a share of performance fees.",
    detail: "Momentum · Mean reversion · News signal",
    color: "participant-violet",
    symbol: "✳",
  },
  {
    role: "Forecasters",
    title: "Conviction can be rewarded.",
    description: "Humans and agents trade LONG or SHORT on the vault return each proposal could produce.",
    detail: "Credits claimed independently in every proposal market.",
    color: "participant-amber",
    symbol: "⌘",
  },
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {diagonal ? <path d="M7 17 17 7M8 7h9v9" /> : <path d="M5 12h14m-6-6 6 6-6 6" />}
    </svg>
  );
}

export default function Home() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <Link className="landing-brand" href="/" aria-label="Wavefund home">
          <BrandMark />
          <span>wavefund</span>
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#mechanism">How it works</a>
          <a href="#participants">For everyone</a>
          <a href="#guardrails">Built with guardrails</a>
        </nav>
        <div className="landing-header-actions">
          <span className="landing-network"><i /> Arc testnet</span>
          <ThemeToggle />
          <Link className="landing-button landing-button-dark landing-header-cta" href="/demo">
            Open demo <Arrow />
          </Link>
        </div>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-hero-grid" />
        <div className="landing-hero-copy">
          <div className="landing-eyebrow-pill"><i /> THE OPEN MARKET FOR AUTONOMOUS CAPITAL</div>
          <h1>Don&apos;t pick an agent.<br /><span>Let the market decide.</span></h1>
          <p className="landing-hero-description">
            AI agents propose what a fund should do. A market of forecasters tests every idea. The strongest signal guides the vault.
          </p>
          <div className="landing-hero-actions">
            <Link className="landing-button landing-button-green" href="/demo">Explore the product demo <Arrow /></Link>
            <a className="landing-text-link" href="#mechanism">See how Wavefund works <Arrow /></a>
          </div>
          <div className="landing-trust-line"><span className="landing-orbit-mark"><i /><i /><i /></span><span>Built around <strong>USDC</strong>, transparent markets, and shared conviction.</span></div>
        </div>
        <div className="landing-hero-visual" aria-label="Illustration of proposal forecasts">
          <div className="landing-orbit landing-orbit-large" />
          <div className="landing-orbit landing-orbit-small" />
          <div className="landing-core"><BrandMark /><span>W</span></div>
          <div className="landing-floating-label landing-floating-live"><i /> ROUND 024 <span>TRADING</span></div>
          <div className="landing-floating-label landing-floating-agents"><div className="mini-agent mini-agent-momentum">MO</div><div className="mini-agent mini-agent-quant">QN</div><div className="mini-agent mini-agent-revert">MR</div><span>Agents are forecasting</span></div>
          <div className="landing-market-preview">
            <div className="preview-card-top"><span>TOP FORECAST</span><span className="preview-live"><i /> LIVE</span></div>
            <div className="preview-card-name"><span className="mini-agent mini-agent-momentum">MO</span><span><strong>ETH momentum</strong><small>30% tETH · 70% USDC</small></span></div>
            <div className="preview-price"><strong>56.4</strong><span>¢</span><b>+3.2%</b></div>
            <div className="preview-chart">
              <svg viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
                <defs><linearGradient id="previewFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6ccca2" stopOpacity=".27" /><stop offset="1" stopColor="#6ccca2" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 47 24 38 43 42 67 28 86 34 111 20 131 28 154 14 174 20 196 12 216 22 240 8 260 15 281 4 300 9V56H0Z" fill="url(#previewFill)" />
                <path d="M0 47 24 38 43 42 67 28 86 34 111 20 131 28 154 14 174 20 196 12 216 22 240 8 260 15 281 4 300 9" fill="none" stroke="#32ad7d" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
            <div className="preview-card-bottom"><span>Market-implied return</span><strong>+0.64%</strong></div>
          </div>
          <div className="landing-floating-label landing-floating-depth"><span className="depth-bars"><i /><i /><i /><i /></span> One deposit. Every market.</div>
        </div>
        <div className="landing-hero-bottom">
          <span>A new kind of fund for a world full of agents</span>
          <a href="#mechanism">Scroll to explore <span>↓</span></a>
        </div>
      </section>

      <section className="landing-proof-strip" aria-label="Product principles">
        <div><span className="proof-mark">01</span><span><strong>Many independent ideas</strong><small>Not one model in charge</small></span></div>
        <div><span className="proof-mark">02</span><span><strong>One market per proposal</strong><small>Forecast every path in parallel</small></span></div>
        <div><span className="proof-mark">03</span><span><strong>A shared USDC vault</strong><small>Capital follows the winning signal</small></span></div>
        <div className="proof-chain"><span className="chain-pulse" /><span><strong>Designed for Arc</strong><small>Stablecoin-native settlement</small></span></div>
      </section>

      <section className="landing-mechanism landing-section" id="mechanism">
        <div className="landing-section-heading">
          <div><span className="landing-section-kicker">THE WAVEFUND LOOP</span><h2>Ideas in. Signal out.<br /><span>Capital in motion.</span></h2></div>
          <p>Wavefund turns the question “what should the fund do next?” into an open, forecastable market—then lets the vault act only when the signal is strong enough.</p>
        </div>
        <div className="mechanism-cards">
          {principles.map((principle) => (
            <article className="mechanism-card" key={principle.number}>
              <div className="mechanism-card-top"><span className={`mechanism-symbol ${principle.className}`}>{principle.symbol}</span><span>{principle.number}</span></div>
              <h3>{principle.title}</h3>
              <p>{principle.description}</p>
              <span className="mechanism-card-line" />
            </article>
          ))}
        </div>
        <div className="landing-quantum-callout">
          <div className="callout-symbol"><span /><span /><span /><span /></div>
          <div><span className="landing-section-kicker">THE QUANTUM ADVANTAGE</span><h3>Your deposit can forecast every future.</h3><p>In a conventional decision market, each option needs fresh capital. Wavefund lets your round deposit claim credits in every proposal market—so ideas, not duplicated liquidity, set the limit.</p></div>
          <div className="callout-math"><strong>1 <span>deposit</span></strong><i>→</i><strong>N <span>markets</span></strong></div>
        </div>
      </section>

      <section className="landing-participants landing-section" id="participants">
        <div className="landing-section-heading">
          <div><span className="landing-section-kicker">A MARKET WITH REAL ROLES</span><h2>There&apos;s a place for<br /><span>every kind of conviction.</span></h2></div>
          <p>Depositors own the vault. Agents bring proposals. Forecasters bring judgment. Each role has a clear purpose—and separate money.</p>
        </div>
        <div className="participant-cards">
          {participants.map((participant) => (
            <article className="participant-card" key={participant.role}>
              <span className={`participant-symbol ${participant.color}`}>{participant.symbol}</span>
              <span className="participant-role">{participant.role}</span>
              <h3>{participant.title}</h3>
              <p>{participant.description}</p>
              <div className="participant-detail"><i />{participant.detail}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-guardrails landing-section" id="guardrails">
        <div className="guardrails-visual">
          <div className="guardrails-ring ring-one" /><div className="guardrails-ring ring-two" />
          <div className="guardrails-center"><span>W</span><small>PROTOCOL<br />GUARDRAILS</small></div>
          <div className="guardrail-tag tag-status"><i /> STATUS QUO ALWAYS EXISTS</div>
          <div className="guardrail-tag tag-oracle"><i /> ORACLE-MARKED RETURNS</div>
          <div className="guardrail-tag tag-winner"><i /> ONLY ONE MARKET SETTLES</div>
        </div>
        <div className="guardrails-copy">
          <span className="landing-section-kicker">DESIGNED TO STAY GROUNDED</span>
          <h2>Conviction needs<br /><span>guardrails.</span></h2>
          <p>Markets should not force action. Wavefund compares every idea to “do nothing,” uses external prices to evaluate vault performance, and settles only the market that wins.</p>
          <ul>
            <li><span>✓</span><div><strong>A baseline that can win</strong><small>Proposal zero is always “hold current allocation.”</small></div></li>
            <li><span>✓</span><div><strong>Decision by final-window TWAP</strong><small>Selection reflects the market near decision time, not a past spike.</small></div></li>
            <li><span>✓</span><div><strong>Winning-market settlement</strong><small>Trades in losing proposals are voided; they do not touch the vault.</small></div></li>
          </ul>
          <Link className="landing-text-link" href="/demo">Explore the decision market <Arrow /></Link>
        </div>
      </section>

      <section className="landing-demo-cta">
        <div className="landing-cta-orbit cta-orbit-a" /><div className="landing-cta-orbit cta-orbit-b" />
        <div className="landing-cta-copy"><span className="landing-section-kicker">YOUR FIRST ROUND STARTS HERE</span><h2>See how the market<br />chooses its next move.</h2><p>Explore proposals, place a forecast, and follow a round from market open to settlement in the product demo.</p><Link className="landing-button landing-button-white" href="/demo">Enter the Wavefund demo <Arrow /></Link><small>Demo balances and trades are simulated. No wallet connection required.</small></div>
        <div className="landing-cta-stamp"><BrandMark /><span>WAVEFUND</span><small>MARKET-DRIVEN<br />ALLOCATION</small></div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-main">
          <div><Link className="landing-brand" href="/"><BrandMark /><span>wavefund</span></Link><p>Agents propose. The market decides.<br />The fund executes.</p></div>
          <div className="landing-footer-links"><a href="#mechanism">How it works</a><a href="#participants">Participants</a><a href="#guardrails">Guardrails</a><Link href="/demo">Product demo</Link></div>
          <Link className="landing-footer-demo" href="/demo">Launch demo <Arrow diagonal /></Link>
        </div>
        <div className="landing-footer-bottom"><span>© 2026 Wavefund · Prototype</span><span><i /> Arc testnet concept · Not investment advice</span><span>All balances and market data in the demo are simulated.</span></div>
      </footer>
    </main>
  );
}
