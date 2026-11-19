import React from 'react';
import type { ConnectionDoc } from '../lib/connectionsStore';
import { dateLabel, initials, personName } from '../lib/presentation';

export function PersonHeading({ person }: { person: ConnectionDoc }) {
  const name = personName(person);
  return (
    <div className="d-head">
      <span className="avatar lg" aria-hidden="true">
        {initials(name)}
      </span>
      <div>
        <h2>{name}</h2>
        <p>{[person.position || 'No title in export', person.company].filter(Boolean).join(' · ')}</p>
        {(person.connectedOn || person.connectedOnRaw) && (
          <p className="hint">connected {dateLabel(person.connectedOn || person.connectedOnRaw, true)}</p>
        )}
      </div>
    </div>
  );
}
export function PersonFacts({ person: p }: { person: ConnectionDoc }) {
  const facts: [string, string | number][] = [];
  if (p.messageCount)
    facts.push([
      'Messages',
      `${p.messageCount}${p.messagesSent != null || p.messagesReceived != null ? ` · one-to-one: ${p.messagesSent ?? 'unknown'} sent, ${p.messagesReceived ?? 'unknown'} received` : ''}`,
    ]);
  if (p.lastMessagedAt) facts.push(['Last contact', dateLabel(p.lastMessagedAt)]);
  if (p.firstMessagedAt) facts.push(['First contact', dateLabel(p.firstMessagedAt)]);
  if (p.connectedOn || p.connectedOnRaw)
    facts.push(['Connected', dateLabel(p.connectedOn || p.connectedOnRaw)]);
  if (p.endorsementCount) facts.push(['Endorsements', p.endorsementCount]);
  if (p.recommendedYou) facts.push(['Recommended you', 'Yes']);
  if (p.invitation)
    facts.push([
      'Invitation',
      `${p.invitation === 'incoming' ? 'They invited you' : 'You invited them'}${p.invitedAt ? ` · ${dateLabel(p.invitedAt)}` : ''}`,
    ]);
  return (
    <>
      {!!facts.length && (
        <section className="d-sec">
          <h3>Facts</h3>
          <dl className="facts">
            {facts.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      )}
      {p.note && (
        <section className="d-sec">
          <h3>Your note</h3>
          <p className="lead break-text">{p.note}</p>
        </section>
      )}
    </>
  );
}
