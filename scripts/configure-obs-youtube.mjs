import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PROFILE_NAME = "SISMICA 24-7";
const SCENE_COLLECTION_NAME = "SISMICA 24-7";
const LIVE_SCENE_NAME = "SISMICA LIVE";
const BROWSER_INPUT_NAME = "PLATAFORMA SISMICA";
const WEB_URL = process.env.SISMICA_OBS_WEB_URL ?? "http://localhost:5173/";
const OBS_ADDRESS = process.env.SISMICA_OBS_WS_URL ?? "ws://127.0.0.1:4455";
const STREAM_ENCODER = process.env.SISMICA_OBS_STREAM_ENCODER ?? "amd";
const YOUTUBE_RTMPS_SERVER = "rtmps://a.rtmps.youtube.com/live2";

function base64Sha256(value) {
  return createHash("sha256").update(value).digest("base64");
}

async function readObsWebSocketPassword() {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error("APPDATA no esta definido");
  const configPath = join(appData, "obs-studio", "plugin_config", "obs-websocket", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return typeof config.server_password === "string" ? config.server_password : "";
}

class ObsWebSocketClient {
  constructor(url, password) {
    this.url = url;
    this.password = password;
    this.socket = null;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timeout = setTimeout(() => reject(new Error("Timeout conectando a OBS WebSocket")), 10_000);

      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("No se pudo conectar a OBS WebSocket"));
      };
      socket.onclose = () => {
        for (const { reject: rejectRequest } of this.pending.values()) {
          rejectRequest(new Error("OBS WebSocket cerro la conexion"));
        }
        this.pending.clear();
      };
      socket.onmessage = async (event) => {
        const message = JSON.parse(String(event.data));
        if (message.op === 0) {
          const authentication = message.d.authentication;
          let auth;
          if (authentication) {
            const secret = base64Sha256(`${this.password}${authentication.salt}`);
            auth = base64Sha256(`${secret}${authentication.challenge}`);
          }
          socket.send(JSON.stringify({
            op: 1,
            d: {
              rpcVersion: 1,
              eventSubscriptions: 0,
              ...(auth ? { authentication: auth } : {})
            }
          }));
          return;
        }
        if (message.op === 2) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.op === 7) {
          const requestId = message.d.requestId;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          this.pending.delete(requestId);
          const status = message.d.requestStatus;
          if (!status.result) {
            pending.reject(new Error(`${pending.requestType} -> ${status.code}: ${status.comment ?? "Solicitud OBS rechazada"}`));
            return;
          }
          pending.resolve(message.d.responseData ?? {});
        }
      };
    });
  }

  request(requestType, requestData = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("OBS WebSocket no esta conectado"));
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timeout en solicitud OBS: ${requestType}`));
      }, 10_000);
      this.pending.set(requestId, {
        requestType,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function ensureProfile(client) {
  const profiles = await client.request("GetProfileList");
  if (!profiles.profiles?.some((profile) => (typeof profile === "string" ? profile : profile.profileName) === PROFILE_NAME)) {
    await client.request("CreateProfile", { profileName: PROFILE_NAME });
  }
  if (profiles.currentProfileName !== PROFILE_NAME) {
    await client.request("SetCurrentProfile", { profileName: PROFILE_NAME });
  }

  const parameters = [
    ["Output", "Mode", "Simple"],
    ["Output", "RetryDelay", "2"],
    ["Output", "MaxRetries", "100"],
    ["SimpleOutput", "StreamEncoder", STREAM_ENCODER],
    ["SimpleOutput", "RecEncoder", STREAM_ENCODER],
    ["SimpleOutput", "VBitrate", "10000"],
    ["SimpleOutput", "ABitrate", "128"],
    ["SimpleOutput", "UseAdvanced", "true"],
    ["SimpleOutput", "NVENCPreset2", "p5"],
    ["Video", "BaseCX", "1920"],
    ["Video", "BaseCY", "1080"],
    ["Video", "OutputCX", "1920"],
    ["Video", "OutputCY", "1080"],
    ["Video", "FPSType", "0"],
    ["Video", "FPSCommon", "30"],
    ["Video", "ColorFormat", "NV12"],
    ["Video", "ColorSpace", "709"],
    ["Video", "ColorRange", "Partial"],
    ["Audio", "SampleRate", "48000"],
    ["Audio", "ChannelSetup", "Stereo"]
  ];
  for (const [parameterCategory, parameterName, parameterValue] of parameters) {
    await client.request("SetProfileParameter", {
      parameterCategory,
      parameterName,
      parameterValue
    });
  }

  await client.request("SetVideoSettings", {
    baseWidth: 1920,
    baseHeight: 1080,
    outputWidth: 1920,
    outputHeight: 1080,
    fpsNumerator: 30,
    fpsDenominator: 1
  });
}

async function ensureSceneCollection(client) {
  const collections = await client.request("GetSceneCollectionList");
  if (!collections.sceneCollections?.includes(SCENE_COLLECTION_NAME)) {
    await client.request("CreateSceneCollection", { sceneCollectionName: SCENE_COLLECTION_NAME });
  } else if (collections.currentSceneCollectionName !== SCENE_COLLECTION_NAME) {
    await client.request("SetCurrentSceneCollection", { sceneCollectionName: SCENE_COLLECTION_NAME });
  }
}

async function ensureLiveScene(client) {
  const sceneList = await client.request("GetSceneList");
  if (!sceneList.scenes?.some((scene) => scene.sceneName === LIVE_SCENE_NAME)) {
    await client.request("CreateScene", { sceneName: LIVE_SCENE_NAME });
  }

  const inputs = await client.request("GetInputList");
  if (inputs.inputs?.some((input) => input.inputName === BROWSER_INPUT_NAME)) {
    await client.request("SetInputSettings", {
      inputName: BROWSER_INPUT_NAME,
      inputSettings: {
        url: WEB_URL,
        width: 1920,
        height: 1080,
        fps: 30,
        reroute_audio: true,
        shutdown: false,
        restart_when_active: false
      },
      overlay: true
    });
  } else {
    await client.request("CreateInput", {
      sceneName: LIVE_SCENE_NAME,
      inputName: BROWSER_INPUT_NAME,
      inputKind: "browser_source",
      inputSettings: {
        url: WEB_URL,
        width: 1920,
        height: 1080,
        fps: 30,
        reroute_audio: true,
        shutdown: false,
        restart_when_active: false
      },
      sceneItemEnabled: true
    });
  }

  const { sceneItemId } = await client.request("GetSceneItemId", {
    sceneName: LIVE_SCENE_NAME,
    sourceName: BROWSER_INPUT_NAME
  });
  await client.request("SetSceneItemTransform", {
    sceneName: LIVE_SCENE_NAME,
    sceneItemId,
    sceneItemTransform: {
      positionX: 0,
      positionY: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      alignment: 5,
      boundsType: "OBS_BOUNDS_NONE"
    }
  });
  await client.request("SetSceneItemLocked", {
    sceneName: LIVE_SCENE_NAME,
    sceneItemId,
    sceneItemLocked: true
  });
  await client.request("SetCurrentProgramScene", { sceneName: LIVE_SCENE_NAME });
}

async function isolatePlatformAudio(client) {
  const inputs = await client.request("GetInputList");
  for (const input of inputs.inputs ?? []) {
    if (input.inputKind === "wasapi_output_capture" || input.inputKind === "wasapi_input_capture") {
      await client.request("SetInputMute", { inputName: input.inputName, inputMuted: true });
    }
  }
  await client.request("SetInputMute", { inputName: BROWSER_INPUT_NAME, inputMuted: false });
  await client.request("SetInputVolume", {
    inputName: BROWSER_INPUT_NAME,
    inputVolumeMul: 1
  });
  await client.request("SetInputAudioMonitorType", {
    inputName: BROWSER_INPUT_NAME,
    monitorType: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT"
  });
}

async function configureStreamService(client) {
  const current = await client.request("GetStreamServiceSettings");
  const currentSettings = current.streamServiceSettings ?? {};
  await client.request("SetStreamServiceSettings", {
    streamServiceType: "rtmp_common",
    streamServiceSettings: {
      ...currentSettings,
      service: "YouTube - RTMPS",
      server: YOUTUBE_RTMPS_SERVER,
      key: typeof currentSettings.key === "string" ? currentSettings.key : ""
    }
  });
}

const password = await readObsWebSocketPassword();
const client = new ObsWebSocketClient(OBS_ADDRESS, password);

try {
  await client.connect();
  await ensureProfile(client);
  await ensureSceneCollection(client);
  await ensureLiveScene(client);
  await isolatePlatformAudio(client);
  await configureStreamService(client);
  const audioMonitor = await client.request("GetInputAudioMonitorType", {
    inputName: BROWSER_INPUT_NAME
  });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const screenshotPath = join(process.cwd(), "output", "obs-sismica-preview.png");
  await client.request("SaveSourceScreenshot", {
    sourceName: BROWSER_INPUT_NAME,
    imageFormat: "png",
    imageFilePath: screenshotPath,
    imageWidth: 1280,
    imageHeight: 720,
    imageCompressionQuality: -1
  });
  console.log(JSON.stringify({
    ok: true,
    profile: PROFILE_NAME,
    sceneCollection: SCENE_COLLECTION_NAME,
    scene: LIVE_SCENE_NAME,
    source: BROWSER_INPUT_NAME,
    url: WEB_URL,
    audioMonitorType: audioMonitor.monitorType
  }, null, 2));
} finally {
  client.close();
}
