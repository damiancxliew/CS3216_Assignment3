import { loadFixtureJson, I1_FIXTURE } from "@adventure/generation/fixtures";
import { findPath, type Point, type StageMap } from "@adventure/game-core";
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

async function tabTo(page: import("playwright").Page, predicate: (text: string, tag: string) => boolean, limit = 30) {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    const text = await focused.textContent().catch(() => "") ?? "";
    const tag = await focused.evaluate((element) => element.tagName).catch(() => "");
    if (predicate(text, tag)) return focused;
  }
  throw new Error("keyboard target not found");
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

it.runIf(runBrowser)("signs in, joins, walks by keyboard, and enters an open room", async () => {
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
    const summary = await tabTo(page, (text) => text.includes("Local dev sign-in"), 20);
    await summary.press("Enter");
    const email = await tabTo(page, (_text, tag) => tag === "INPUT", 20);
    await email.press("Control+A");
    await email.pressSequentially(studentEmail);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+A");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForURL(joinUrl);
    const enter = await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes("Enter the adventure"), 20);
    await enter.press("Enter");
    await page.waitForURL(/\/play\//);
    const attemptId = new URL(page.url()).pathname.split("/").at(-1)!;
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
    console.log(`beforeNavigation=${JSON.stringify(publicSummary(refreshed))}`);
    const navigation = await tabTo(page, (text, tag) => tag === "BUTTON" && text.includes(openRoom.name), 40);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await publicState(page, attemptId)).body.currentRoomId, { timeout: 30_000 }).toBe(openRoom.id);
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
}, 120_000);
