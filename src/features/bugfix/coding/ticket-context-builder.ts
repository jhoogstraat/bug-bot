import type { NormalizedBugTicket } from "../ticket.js";
export function buildTicketContext(ticket: NormalizedBugTicket): string {
  return JSON.stringify(ticket);
}
