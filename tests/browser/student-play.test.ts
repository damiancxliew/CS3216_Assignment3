import { loadFixtureJson, I1_FIXTURE } from "@adventure/generation/fixtures";
import { canStep, findPath, spaceAt, type Point, type StageMap } from "@adventure/game-core";
import { chromium } from "playwright";
import { beforeAll, expect, it } from "vitest";

import { persistSpecVersion } from "../../apps/web/src/lib/adventures/persist-spec";
import { findForbiddenKeys } from "@/lib/turn-api/contract";
import { createUserClient, serviceClient, uniqueEmail, SUPABASE_URL } from "../db/helpers";

const runBrowser = process.env.RUN_BROWSER_TESTS === "1";
const BASE_URL = "http://127.0.0.1:3000";
const PASSWORD = "password123!";

let joinUrl: string;
let studentEmail: string;

beforeAll(async () => {
  if (!runBrowser) return;
  if (!SUPABASE_URL.startsWith("http://127.0.0.1:")) throw new Error("browser test requires local Supabase");
  const admin = serviceClient();
  const teacher = await createUserClient(uniqueEmail("browser-teacher"));
  const { data: adventure, error: adventureError } = await admin.from("adventure").insert({ owner_id: teacher.userId, title: "Local browser adventure", default_timer_seconds: 600 }).select("id, share_token").single();
  if (adventureError) throw adventureError;
  await persistSpecVersion(admin, adventure.id, await loadFixtureJson(I1_FIXTURE.spec), { generatorVersion: "browser-test", createdBy: teacher.userId });
  const { error: publishError } = await teacher.client.rpc("publish_adventure", { p_adventure_id: adventure.id });
  if (publishError) throw publishError;
  studentEmail = uniqueEmail("browser-student");
  joinUrl = `${BASE_URL}/join/${adventure.share_token}`;
});

async function tabTo(page: import("playwright").Page, predicate: (text: string, tag: string, role: string | null) => boolean, limit = 30): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      return { text: element?.textContent ?? "", tag: element?.tagName ?? "", role: element?.getAttribute("role") ?? null };
    });
    if (predicate(focused.text, focused.tag, focused.role)) return;
  }
  throw new Error("keyboard target not found");
}

async function openRoomControls(page: import("playwright").Page, name: "Go somewhere" | "Look around") {
  const summary = page.locator("summary").filter({ hasText: name });
  if (await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) return;
  await tabTo(page, (text, tag) => tag === "SUMMARY" && text.includes(name), 50);
  await page.keyboard.press("Enter");
}

async function chooseSpeaker(page: import("playwright").Page, name: string) {
  // A single nearby person is introduced directly; selection is only needed in a group.
  if (await page.getByRole("radio").filter({ hasText: name }).count()) {
    await tabTo(page, (text, tag, role) => tag === "BUTTON" && role === "radio" && text.includes(name), 50);
    await page.keyboard.press("Space");
  }
  await page.getByRole("heading").filter({ hasText: name }).waitFor();
}

function publicSummary(body: any) {
  return { playerPos: body.playerPos, actors: body.actors?.map((actor: any) => ({ id: actor.id, position: actor.position })), hearingActorIds: body.hearingActorIds, currentRoomId: body.currentRoomId };
}

async function publicState(page: import("playwright").Page, attemptId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/attempt/${id}/state`, { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, attemptId);
}

function liveDoors(state: { map: StageMap; rooms: { id: string; doorOpen: boolean }[] }) {
  return Object.fromEntries(state.map.doors.map((door) => [door.id, state.rooms.find((room) => room.id === door.roomId)?.doorOpen ? "open" : "closed"]));
}

async function keyboardWalk(page: import("playwright").Page, attemptId: string, initial: any, target: Point) {
  let state = initial;
  const map = { ...state.map, seed: "" } as StageMap;
  const path = findPath(map, liveDoors(state), state.playerPos, target);
  if (!path) throw new Error("browser test could not find a public path");
  for (let tab = 0; tab < 30; tab += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.tagName === "CANVAS")) break;
  }
  await expect.poll(async () => page.evaluate(() => document.activeElement?.tagName)).toBe("CANVAS");
  for (const point of path) {
    const from = state.playerPos as Point;
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const key = dx === 1 ? "ArrowRight" : dx === -1 ? "ArrowLeft" : dy === 1 ? "ArrowDown" : "ArrowUp";
    await page.keyboard.press(key);
    await page.waitForTimeout(170);
    await expect.poll(async () => {
      const next = await publicState(page, attemptId);
      expect(next.status).toBe(200);
      return next.body.playerPos;
    }, { timeout: 5_000 }).toEqual(point);
    state = (await publicState(page, attemptId)).body;
  }
  return state;
}

it.runIf(runBrowser)("plays a student stage by keyboard with pending dialogue, evidence, decisions, and resume", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors: string[] = [];
  const apiBodies: unknown[] = [];
  const actionTraffic: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/attempt/") && request.method() === "POST" && request.url().endsWith("/action")) actionTraffic.push(`request ${request.postData() ?? ""}`);
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/attempt/")) return;
    const contentType = response.headers()["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      const body = await response.json().catch(() => null);
      apiBodies.push(body);
      if (response.url().endsWith("/action")) actionTraffic.push(`response ${JSON.stringify(body)}`);
    }
  });
  try {
    await page.goto(joinUrl, { waitUntil: "networkidle" });
    await page.locator("summary").filter({ hasText: "Local dev sign-in" }).waitFor({ state: "visible" });
    await tabTo(page, (text, tag) => tag === "SUMMARY" && text.includes("Local dev sign-in"), 30);
    await page.keyboard.press("Enter");
    await tabTo(page, (_text, tag) => tag === "INPUT", 20);
    await page.keyboard.press("Control+A");
    await page.keyboard.type(studentEmail);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+A");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForURL(joinUrl);
    await page.getByRole("button", { name: "Enter the adventure", exact: true }).waitFor({ state: "visible" });
    await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes("Enter the adventure"), 50);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/play\//);
    const attemptId = new URL(page.url()).pathname.split("/").at(-1)!;
    const navigateRoom = async (roomId: string) => {
      let state = (await publicState(page, attemptId)).body;
      const room = state.rooms.find((candidate: any) => candidate.id === roomId);
      const mapRoom = state.map.rooms.find((candidate: any) => candidate.id === roomId);
      const door = state.map.doors.find((candidate: any) => candidate.roomId === roomId);
      expect(room).toBeDefined();
      expect(mapRoom).toBeDefined();
      const goal = mapRoom.enclosure === "open" ? { x: mapRoom.x + Math.floor(mapRoom.width / 2), y: mapRoom.y + Math.floor(mapRoom.height / 2) } : door?.inside;
      expect(goal).toBeDefined();
      if (state.currentRoomId === roomId) return keyboardWalk(page, attemptId, state, goal);
      if (!room.doorOpen && door) {
        await keyboardWalk(page, attemptId, state, door.outside);
        // A resumed player at the doorstep must still see the knock control.
        await page.reload({ waitUntil: "networkidle" });
        await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes(`Knock on ${room.name}`), 50);
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await publicState(page, attemptId)).body.rooms.find((candidate: any) => candidate.id === roomId)?.doorOpen, { timeout: 30_000 }).toBe(true);
      }
      state = (await publicState(page, attemptId)).body;
      await openRoomControls(page, "Go somewhere");
      await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes(room.name), 50);
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await publicState(page, attemptId)).body.currentRoomId, { timeout: 30_000 }).toBe(roomId);
      await expect.poll(async () => (await publicState(page, attemptId)).body.playerPos, { timeout: 30_000 }).toEqual(goal);
      return (await publicState(page, attemptId)).body;
    };
    await page.locator('canvas[tabindex="0"]').waitFor({ state: "visible" });
    await page.screenshot({ path: "/tmp/spatial-browser-start.png" });
    const initial = (await publicState(page, attemptId)).body;
    const agent = initial.actors.find((actor: any) => actor.kind === "agent" && actor.position);
    expect(agent).toBeDefined();
    await keyboardWalk(page, attemptId, initial, agent.position);
    const saved = (await publicState(page, attemptId)).body;
    expect(saved.playerPos).toEqual(agent.position);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('canvas[tabindex="0"]').waitFor({ state: "visible" });
    const refreshed = (await publicState(page, attemptId)).body;
    expect(refreshed.map.id).toBe(initial.map.id);
    expect(refreshed.playerPos).toEqual(saved.playerPos);
    expect(refreshed.revision).toBe(saved.revision);
    const openRoom = refreshed.rooms.find((room: any) => room.id !== refreshed.currentRoomId && room.doorOpen === true);
    expect(openRoom).toBeDefined();
    await openRoomControls(page, "Go somewhere");
    await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes(openRoom.name), 40);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await publicState(page, attemptId)).body.currentRoomId, { timeout: 30_000 }).toBe(openRoom.id);
    const destination = refreshed.map.rooms.find((room: any) => room.id === openRoom.id);
    const goal = destination.enclosure === "open"
      ? { x: destination.x + Math.floor(destination.width / 2), y: destination.y + Math.floor(destination.height / 2) }
      : refreshed.map.doors.find((door: any) => door.roomId === openRoom.id)?.inside;
    expect(goal).toBeDefined();
    await expect.poll(async () => (await publicState(page, attemptId)).body.playerPos, { timeout: 30_000 }).toEqual(goal);
    const desktopGeometry = await page.evaluate(() => {
      const composer = document.querySelector('section[aria-labelledby="talk"] form')!.getBoundingClientRect();
      const goals = document.querySelector('section[aria-labelledby="decide"]')!.getBoundingClientRect();
      return { composerBottom: composer.bottom, goalsTop: goals.top };
    });
    expect(desktopGeometry.composerBottom).toBeLessThanOrEqual(desktopGeometry.goalsTop + 1);
    await page.setViewportSize({ width: 384, height: 844 });
    const mobileGeometry = await page.evaluate(() => {
      const composer = document.querySelector('section[aria-labelledby="talk"] form')!.getBoundingClientRect();
      const goals = document.querySelector('section[aria-labelledby="decide"]')!.getBoundingClientRect();
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, composerBottom: composer.bottom, goalsTop: goals.top };
    });
    expect(mobileGeometry.scrollWidth).toBeLessThanOrEqual(mobileGeometry.clientWidth);
    expect(mobileGeometry.composerBottom).toBeLessThanOrEqual(mobileGeometry.goalsTop + 1);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('canvas[tabindex="0"]').waitFor({ state: "visible" });
    const dialogueState = (await publicState(page, attemptId)).body;
    const farquhar = dialogueState.actors.find((actor: any) => actor.id === "agent-farquhar-s0");
    expect(farquhar?.position).toBeDefined();
    await keyboardWalk(page, attemptId, dialogueState, farquhar.position);
    const coLocated = (await publicState(page, attemptId)).body;
    await chooseSpeaker(page, "Farquhar");
    await tabTo(page, (_text, tag) => tag === "INPUT", 30);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("INPUT");
    await page.keyboard.type("Wait while I walk");
    const messageResponse = page.waitForResponse((response) => response.url().includes(`/api/attempt/${attemptId}/message`) && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await publicState(page, attemptId)).body.pendingDialogue, { timeout: 10_000 }).toBe(true);
    const map = { ...coLocated.map, seed: "" } as StageMap;
    const current = (await publicState(page, attemptId)).body.playerPos as Point;
    const step = [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }].find((point) => spaceAt(map, point)?.kind === "outdoor" && canStep(map, liveDoors(coLocated), current, point));
    expect(step).toBeDefined();
    await tabTo(page, (_text, tag) => tag === "CANVAS", 50);
    const actionResponse = page.waitForResponse((response) => response.url().includes(`/api/attempt/${attemptId}/action`) && response.request().method() === "POST");
    const dx = step!.x - current.x;
    const dy = step!.y - current.y;
    await page.keyboard.press(dx === 1 ? "ArrowRight" : dx === -1 ? "ArrowLeft" : dy === 1 ? "ArrowDown" : "ArrowUp");
    const actionBody = await (await actionResponse).json();
    expect(actionBody.accepted).toBe(true);
    expect(actionBody.state.playerPos).toEqual(step);
    expect(actionBody.state.pendingDialogue).toBe(true);
    const messageBody = await (await messageResponse).json();
    expect(messageBody.accepted).toBe(true);
    expect(messageBody.state.playerPos).toEqual(step);
    expect(messageBody.state.pendingDialogue).toBe(false);
    expect(messageBody.state.transcript.some((message: any) => message.body === "I will hear your proposal.")).toBe(true);
    expect(messageBody.state.stage.objectives.some((objective: any) => objective.id === "obj-hear-farquhar" && objective.met)).toBe(false);
    for (const room of (await publicState(page, attemptId)).body.rooms) {
      let roomState = await navigateRoom(room.id);
      for (const item of roomState.evidenceHere) {
        if (!await page.getByRole("dialog", { name: item.name }).isVisible()) {
          await openRoomControls(page, "Look around");
          await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes(`Read ${item.name}`), 50);
          await page.keyboard.press("Enter");
        }
        await expect.poll(async () => (await publicState(page, attemptId)).body.journal.some((entry: any) => entry.id === item.id), { timeout: 30_000 }).toBe(true);
        await expect.poll(async () => page.getByRole("dialog", { name: item.name }).isVisible()).toBe(true);
        expect(await page.getByRole("button", { name: "Roll up scroll" }).isVisible()).toBe(true);
        await page.getByRole("button", { name: "Roll up scroll" }).click();
        expect(await page.getByRole("dialog", { name: item.name }).count()).toBe(0);
        roomState = (await publicState(page, attemptId)).body;
      }
    }
    let farquharState = await navigateRoom("landing-beach");
    const farquharAgentAtBeach = farquharState.actors.find((actor: any) => actor.id === "agent-farquhar-s0");
    expect(farquharAgentAtBeach?.position).toBeDefined();
    await keyboardWalk(page, attemptId, farquharState, farquharAgentAtBeach.position!);
    await chooseSpeaker(page, "Farquhar");
    await tabTo(page, (_text, tag) => tag === "INPUT", 30);
    await page.keyboard.type("My notes mention the sheltered river mouth. What makes it a suitable place for the Company?");
    const farquharResponse = page.waitForResponse((response) => response.url().includes(`/api/attempt/${attemptId}/message`) && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    const farquharBody = await (await farquharResponse).json();
    expect(farquharBody.accepted).toBe(true);
    expect(farquharBody.state.stage.objectives.some((objective: any) => objective.id === "obj-hear-farquhar" && objective.met)).toBe(true);
    let temenggongState = await navigateRoom("temenggong-hall");
    const temenggong = temenggongState.actors.find((actor: any) => actor.id === "agent-temenggong-s0");
    const temenggongAgent = temenggongState.agents.find((agent: any) => agent.id === "agent-temenggong-s0");
    expect(temenggong?.position).toBeDefined();
    expect(temenggongAgent?.name).toBeDefined();
    temenggongState = await keyboardWalk(page, attemptId, temenggongState, temenggong.position);
    await chooseSpeaker(page, temenggongAgent.name);
    await tabTo(page, (_text, tag) => tag === "INPUT", 50);
    await page.keyboard.type("What should I tell Raffles?");
    const temenggongResponse = page.waitForResponse((response) => response.url().includes(`/api/attempt/${attemptId}/message`) && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    const temenggongBody = await (await temenggongResponse).json();
    expect(temenggongBody.accepted).toBe(true);
    expect(temenggongBody.state.stage.objectives.some((objective: any) => objective.id === "obj-meet-temenggong" && objective.met)).toBe(true);
    const stageOneReady = (await publicState(page, attemptId)).body;
    expect(stageOneReady.stage.objectives.every((objective: any) => objective.met)).toBe(true);
    const option = stageOneReady.options.find((candidate: any) => candidate.available);
    expect(option).toBeDefined();
    if (await page.getByRole("button").filter({ hasText: option.label }).count() === 0) {
      await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes("You can decide now"), 50);
      await page.keyboard.press("Enter");
    }
    await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes(option.label), 50);
    const decisionResponse = page.waitForResponse((response) => response.url().includes(`/api/attempt/${attemptId}/decision`) && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    const decisionBody = await (await decisionResponse).json();
    expect(decisionBody.state.stage.index).toBe(1);
    expect(decisionBody.state.map.id).not.toBe(stageOneReady.map.id);
    await page.locator('canvas[tabindex="0"]').waitFor({ state: "visible" });
    await expect.poll(async () => page.locator("header").innerText(), { timeout: 15_000 }).toContain("Stage 2");
    await expect.poll(async () => page.locator("header").innerText(), { timeout: 15_000 }).toContain(decisionBody.state.stage.title);
    await page.screenshot({ path: "/tmp/spatial-browser-stage-transition.png" });
    await page.screenshot({ path: "/tmp/spatial-browser-dialogue.png" });
    await page.screenshot({ path: "/tmp/spatial-browser-result.png" });
    expect(pageErrors).toEqual([]);
    for (const body of apiBodies) expect(findForbiddenKeys(body)).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: "/tmp/spatial-browser-result.png" }).catch(() => undefined);
    const after = await page.url().includes("/play/") ? await publicState(page, page.url().split("/").at(-1)!) : null;
    const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName ?? null, text: document.activeElement?.textContent ?? "" }));
    console.log(`joinUrl=${joinUrl} studentEmail=${studentEmail}`);
    console.log(`lastActionTraffic=${JSON.stringify(actionTraffic.slice(-8))}`);
    console.log(`afterState=${JSON.stringify(after ? publicSummary(after.body) : null)}`);
    console.log(`activeElement=${JSON.stringify(active)} pageErrors=${JSON.stringify(pageErrors)}`);
    throw error;
  } finally {
    await browser.close();
  }
}, 300_000);
