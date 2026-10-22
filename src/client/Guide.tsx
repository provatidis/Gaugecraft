import { assetUrl } from "./data.js";

export type ResearchPage =
  "markets" | "opportunities" | "analysis" | "simulator" | "performance";

type Navigate = (page: ResearchPage) => void;

// Adapted from README's research routine. Keep calculation details in SOURCES.md.
const help: Record<ResearchPage, { title: string; paragraphs: string[] }> = {
  markets: {
    title: "Pool rewards are shared. How do I estimate my earnings?",
    paragraphs: [
      "Markets starts with modeled earnings for your intended allocation power, or 1,000 additional reference power if blank. Own dilution is included. Switch to Stress-case earnings or Pool-wide rewards when useful; the sort is remembered. Pool rewards are shared totals, not your individual earnings.",
      "History-based estimates and constant-condition baselines are sorted in separate evidence groups. Comparable earnings require near-full 48-hour fee windows, current data and complete prices. Partial observations remain visible for research, with earnings withheld. A dash means unavailable, not zero.",
    ],
  },
  analysis: {
    title: "What is measured, and what looks ahead?",
    paragraphs: [
      "Fees and volume describe past activity over the displayed source window. Incentives 48h integrates scheduled programs over the next 48 hours, stopping at expiry with no renewal assumed. USD values use spot estimates. Chart ranges show only the history actually collected.",
      "Compare revenue with allocation power. An APR jump can come from falling allocation rather than growing revenue. Partial fee windows weaken comparisons; missing history cannot establish persistence.",
    ],
  },
  opportunities: {
    title: "When is this a persistence ranking?",
    paragraphs: [
      "Insufficient history means there is not enough evidence to rank persistence. The initial list is a baseline comparison. Qualification needs roughly 48 hours, at least 80 priced fee observations, no gap over 75 minutes and a near-full fee window. Stale pools are excluded.",
      "Qualified pools are ranked for the power selected in Markets, or 1,000 additional reference power, including your own dilution, under a 50% decline in forecast fees and 50% more competing power on top of projected allocation. Scheduled incentives retain their modeled value. This is a stress assumption, not a confidence interval. Simulate your own size; a larger allocation can change the ordering.",
    ],
  },
  simulator: {
    title: "Allocation power, existing power and capital: what goes where?",
    paragraphs: [
      "Allocation power is your intended total power in this pool, not dollars. Already allocated is your power included in its current total. To increase from 10,000 to 15,000 power, enter 15,000 and 10,000 respectively. Stake value in USD is optional and only supplies the denominator for personal capital APR.",
      "The model removes your existing power before adding your intended power, then integrates your share of revenue over 48 hours. Intended power is shared with Markets and Opportunities. Existing power is saved separately per pool and data mode. Capital and timing assumptions still carry between pools; review them whenever you switch. Blank remaining days models perpetual power; activation delay is an assumption, not a check of eligibility.",
      "Competition scenarios start from current other allocation, without automatically applying the Opportunities allocation-growth forecast. The revenue-down case halves all modeled USD revenue, including incentives. Baseline means no new competition; it is not a prediction. Read the 48-hour earnings before the annualized APR.",
    ],
  },
  performance: {
    title: "What does forecast accuracy actually measure?",
    paragraphs: [
      "Forecasts are frozen when observations arrive and evaluated after 48 hours, only when coverage is sufficient. A mature forecast can remain unevaluable if collection gaps exist. Waiting longer does not recreate missing observations.",
      "Results are observed-data return proxies for 1,000 additional power, not your actual position or claimed rewards. Compare strategies on matched, complete cohorts. Overlapping 48-hour windows are not independent trades or a compounded strategy return.",
    ],
  },
};

export function ContextHelp({
  page,
  onGuide,
}: {
  page: ResearchPage;
  onGuide: () => void;
}) {
  return (
    <details className="context-help" key={page}>
      <summary>{help[page].title}</summary>
      <div className="context-help-body">
        {help[page].paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
        <button className="text-link" onClick={onGuide}>
          Read the research guide →
        </button>
      </div>
    </details>
  );
}

export function GettingStarted({
  onGuide,
  onDismiss,
}: {
  onGuide: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      className="getting-started"
      aria-labelledby="getting-started-title"
    >
      <div className="getting-started-heading">
        <h2 id="getting-started-title">From pool rewards to your share</h2>
        <button className="text-link dismiss-guide" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ol className="starter-steps">
        <li>
          <b>Find promising pools</b>
          <span>Compare earnings for your allocation in Markets.</span>
        </li>
        <li>
          <b>Investigate sustainability</b>
          <span>Check fees, incentive expiry and allocation.</span>
        </li>
        <li>
          <b>Simulate your earnings</b>
          <span>Size your share and test competing power.</span>
        </li>
      </ol>
      <button className="text-link" onClick={onGuide}>
        Read the quick guide →
      </button>
    </section>
  );
}

const steps: {
  title: string;
  text: string;
  page: ResearchPage;
  action: string;
}[] = [
  {
    title: "Check the evidence is current",
    text: "Read Latest retrieval and expand Data health for each network. Times are UTC. Observations older than 75 minutes are stale. Refresh reloads published data; it does not run the hosted collector.",
    page: "markets",
    action: "Open Markets",
  },
  {
    title: "Build a shortlist",
    text: "Enter intended power in Markets, then compare modeled earnings within each evidence group. Try stress earnings or pool-wide rewards as alternative sorts. Filter by network and star candidates. Partial fee windows are visible but do not receive a comparable earnings estimate.",
    page: "markets",
    action: "Find pools",
  },
  {
    title: "Investigate the source of the APR",
    text: "In Pool analysis, compare fees, scheduled incentives and allocation together. Read the actual fee-window duration and incentive expiry. Rising APR with falling allocation can be a denominator change, not more revenue.",
    page: "analysis",
    action: "Open Pool analysis",
  },
  {
    title: "Simulate your intended size",
    text: "Enter your intended total allocation power and any power already in the pool. Intended power carries from Markets; existing power is remembered per pool. Add capital in USD only for personal APR. Compare competition and revenue scenarios, and review timing and capital assumptions when switching pools.",
    page: "simulator",
    action: "Open Simulator",
  },
  {
    title: "Use rankings when evidence is sufficient",
    text: "Opportunities ranks qualified pools by stressed earnings for your selected power. Until enough history exists, it shows baseline comparisons. Insufficient history is a missing-evidence state, not a negative score.",
    page: "opportunities",
    action: "Open Opportunities",
  },
  {
    title: "Review, then evaluate",
    text: "Revisit your watchlist as fees, incentives and allocation change. After 48-hour forecasts mature, use Performance to check errors and compare matched benchmarks. These are return proxies, not a record of your own claims.",
    page: "performance",
    action: "Open Performance",
  },
];

export function Guide({ navigate }: { navigate: Navigate }) {
  return (
    <div className="guide-page">
      <section
        className="guide-principle"
        aria-labelledby="guide-principle-title"
      >
        <div>
          <span className="eyebrow">START WITH THIS DISTINCTION</span>
          <h2 id="guide-principle-title">Pool rewards ≠ your earnings</h2>
          <p>
            <b>Pool rewards are shared by all allocators.</b> Your earnings
            depend on your share after dilution, revenue timing and competing
            allocation.
          </p>
        </div>
        <div className="guide-formula">
          <span>Your share after allocation</span>
          <b>× distributable pool revenue</b>
          <span>≈ your modeled earnings over 48 hours</span>
        </div>
      </section>
      <div className="section-line">
        <div>
          <h2>A repeatable research routine</h2>
          <p>
            Follow the evidence from a shortlist to a scenario you can explain.
          </p>
        </div>
        <span className="badge">A quick orientation</span>
      </div>
      <ol className="guide-steps">
        {steps.map((step) => (
          <li key={step.title} className="panel">
            <div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <button className="text-link" onClick={() => navigate(step.page)}>
                {step.action} →
              </button>
            </div>
          </li>
        ))}
      </ol>
      <section
        className="guide-reference"
        aria-labelledby="guide-reference-title"
      >
        <h2 id="guide-reference-title">When a number needs more context</h2>
        <p>
          Measured history, forward estimates and hypothetical scenarios answer
          different questions.
        </p>
        {(Object.keys(help) as ResearchPage[]).map((page) => (
          <details className="context-help" key={page}>
            <summary>{help[page].title}</summary>
            <div className="context-help-body">
              {help[page].paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
              <button className="text-link" onClick={() => navigate(page)}>
                Explore this section →
              </button>
            </div>
          </details>
        ))}
      </section>
      <div className="guide-resources">
        <p>
          Practice with <b>Sample fixtures</b> in the header; every figure there
          is synthetic. Switch back to <b>Live observations</b> for actual
          pools. Watchlists and simulator inputs stay in this browser.
          Gaugecraft does not track or change your positions.
        </p>
        <div>
          <a
            className="text-link"
            href="https://github.com/provatidis/gaugecraft#how-to-use-gaugecraft-effectively"
            target="_blank"
            rel="noreferrer"
          >
            Detailed guide & worked example ↗
          </a>
          <a
            className="text-link"
            href={assetUrl("SOURCES.md")}
            target="_blank"
            rel="noreferrer"
          >
            Sources & formulas ↗
          </a>
        </div>
      </div>
    </div>
  );
}
