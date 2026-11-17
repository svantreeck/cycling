import { useMemo, useState } from 'react';
import { BLOCK_WEEKS, blockInfo, GOALS, isPromoted, STREAK_FRACTION, weekProgress } from '../game/coach';
import { useGame } from '../store/gameStore';
import { PlanSetup } from './PlanSetup';

const SHORT_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Weekly goal ring, day dots and week streak. Prompts for a plan if none is set. */
export function WeekCard() {
  const { profile } = useGame();
  const [editing, setEditing] = useState(false);
  const { plan, rides } = profile;
  const week = useMemo(() => (plan ? weekProgress(rides, plan) : null), [plan, rides]);
  const block = plan ? blockInfo(plan) : null;
  const retestDue = !!(plan && block?.retestFor && !isPromoted(profile.promotions, plan, block.retestFor));

  if (!plan || !week) {
    return (
      <section className="card week empty">
        <div>
          <h3>Set a goal</h3>
          <p className="muted small">Tell the coach what you're training for and when you can ride. You'll get a weekly target and suggestions that fit your schedule.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing(true)}>
          Set up my plan
        </button>
        {editing && <PlanSetup onClose={() => setEditing(false)} />}
      </section>
    );
  }

  const frac = week.target > 0 ? Math.min(1, week.tss / week.target) : 0;
  const R = 38;
  const C = 2 * Math.PI * R;
  const daysLeft = plan.goal === 'event' && plan.eventDate ? eventCountdown(plan.eventDate) : null;

  return (
    <section className="card week">
      <svg viewBox="0 0 100 100" width={104} className="ring" aria-label={`${week.tss} of ${week.target} TSS this week`}>
        <circle cx={50} cy={50} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
        {/* the streak threshold */}
        <circle cx={50} cy={50} r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={10} strokeDasharray={`1.2 ${C}`} strokeDashoffset={-C * STREAK_FRACTION} transform="rotate(-90 50 50)" />
        <circle
          cx={50}
          cy={50}
          r={R}
          fill="none"
          stroke={week.thisWeekDone ? '#2ecc71' : 'var(--accent)'}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${C * frac} ${C}`}
          transform="rotate(-90 50 50)"
        />
        <text x={50} y={48} textAnchor="middle" className="ring-big">
          {Math.round(frac * 100)}%
        </text>
        <text x={50} y={64} textAnchor="middle" className="ring-small">
          {week.tss}/{week.target}
        </text>
      </svg>

      <div className="week-info">
        <div className="week-head">
          <h3>This week</h3>
          <span className="pill tier">{GOALS[plan.goal].name}</span>
          {daysLeft != null && daysLeft >= 0 && <span className="pill gold">🏁 {daysLeft === 0 ? 'Event today' : `${daysLeft} days to go`}</span>}
        </div>
        {block && (
          <div className="block-row" title="Training blocks: 3 build weeks with rising load, then a recovery week ending with an FTP retest.">
            <span className="block-label">Block {block.number}</span>
            <div className="block-weeks">
              {Array.from({ length: BLOCK_WEEKS }, (_, i) => (
                <span key={i} className={`bw ${i + 1 < block.week ? 'past' : i + 1 === block.week ? 'now' : ''} ${i === BLOCK_WEEKS - 1 ? 'rec' : ''}`} />
              ))}
            </div>
            <span className="muted small">
              {retestDue ? '🎯 FTP retest due: pass it to get promoted' : block.recovery ? 'Recovery week: lighter load, retest at the end' : `Build week ${block.week} of ${BLOCK_WEEKS - 1}`}
            </span>
          </div>
        )}
        <div className="week-days">
          {week.days.map((d) => (
            <div key={d.day} className={`wd ${d.isToday ? 'is-today' : ''} ${d.tss > 0 ? 'rode' : ''} ${d.plannedMin === 0 ? 'rest' : ''}`} title={d.tss > 0 ? `${d.tss} TSS` : d.plannedMin ? `${d.plannedMin} min planned` : 'Rest day'}>
              <span className="wd-dot" />
              <span className="wd-name">{SHORT_DAYS[d.weekday]}</span>
            </div>
          ))}
        </div>
        <div className="muted small">
          {week.streak > 0 ? (
            <>
              🔥 <strong>{week.streak}-week streak</strong>
              {!week.thisWeekDone && ' · reach 80% this week to keep it going'}
            </>
          ) : (
            'Reach 80% of your weekly goal to start a streak. Rest days never break it.'
          )}{' '}
          ·{' '}
          <button className="link" onClick={() => setEditing(true)}>
            Edit plan
          </button>
        </div>
      </div>
      {editing && <PlanSetup onClose={() => setEditing(false)} />}
    </section>
  );
}

function eventCountdown(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const event = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((event.getTime() - today.getTime()) / 86_400_000);
}
