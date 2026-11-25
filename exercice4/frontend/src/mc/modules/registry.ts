"use strict";

/** Route id -> module renderer. "__notifDrawer" is the header bell's drawer. */
import type { Ctx } from "../app";
import { command, story, synthesis, terminal, warroom } from "./command";
import { approvals, audit, calendar, collab, decisions, missions, notifDrawer, notifications, projects, queue, tasks } from "./ops";
import { assistant, detective, forecast, network, profiles, risk, rootcause } from "./intel";
import { compare, crisisSim, sandbox, timemachine, whatif } from "./sim";
import { geo, twin } from "./world";
import { doctor, explorer, settings, sources } from "./datamods";

export type Module = (c: Ctx, el: HTMLElement) => void;
export const MODULES: Record<string, Module> = {
    command, warroom, terminal, story, synthesis,
    queue, missions, tasks, projects, approvals, calendar, decisions, notifications, collab, audit,
    assistant, detective, network, risk, rootcause, forecast, profiles,
    whatif, crisis: crisisSim, sandbox, timemachine, compare,
    twin, geo, explorer, doctor, sources, settings,
    __notifDrawer: notifDrawer
};
