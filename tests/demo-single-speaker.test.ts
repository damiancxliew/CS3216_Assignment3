import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../apps/web/src/app/api/demo/lim-bo-seng/chat/route";
import { newDemoV3State, restoreDemoV3State, createDemoV3Client } from "../apps/web/src/lib/demo/v3-session";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("rejects a provider response that scripts a second historical figure", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test");
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({output_text: JSON.stringify({reply:"Lim: I have public duties. Gan: And our household? Lim: Both matter.", sources:["family"]})})));
  vi.stubGlobal("fetch", fetcher);
  const result = await POST(new NextRequest("http://localhost/api/demo/lim-bo-seng/chat", {method:"POST", headers:{origin:"http://localhost"}, body:JSON.stringify({stage:0,npc:"lim",question:"What concerns you?",history:[],decisions:[]})}));
  const body = await result.json();
  expect(body.mode).toBe("curated");
  expect(body.reply).not.toContain("Gan:");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).instructions).toContain("Speak only as Lim Bo Seng");
});
it("removes other scripted voices in old saved replies without changing student words", () => {
  const state = newDemoV3State();
  state.messages[0].text = "Lim: I have public duties. Gan: And our household? Lim: Both matter.";
  state.messages.push({...state.messages[0], id:"player",kind:"player"});
  const restored = restoreDemoV3State(JSON.stringify(state));
  expect(restored.messages[0].text).toBe("I have public duties.\n\nBoth matter.");
  expect(restored.messages[1].text).toBe(state.messages[1].text);
});
it("keeps the same figure's previous chapter out of current scene history", async () => {
  const state = newDemoV3State(1); state.intro = false;
  state.messages.push({...state.messages[0],id:"old",stageIndex:0,text:"An earlier Singapore conversation."});
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({mode:"live",reply:"Local knowledge matters.",sources:["force"]})));
  const client = createDemoV3Client(state, () => {}, fetcher);
  expect((await client.act(0,{type:"message",characterId:"lim",text:"What matters here?"})).ok).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).history.some((m: {content:string}) => m.content.includes("earlier Singapore"))).toBe(false);
});
