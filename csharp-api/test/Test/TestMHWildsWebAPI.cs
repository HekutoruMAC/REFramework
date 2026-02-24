using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using REFrameworkNET;
using REFrameworkNET.Attributes;

class MHWildsWebAPI {
    static HttpListener s_listener;
    static Thread s_thread;
    static CancellationTokenSource s_cts = new();
    static int s_port = 8899;
    static string s_webRoot;

    static readonly Dictionary<string, string> s_mimeTypes = new() {
        { ".html", "text/html; charset=utf-8" },
        { ".css",  "text/css; charset=utf-8" },
        { ".js",   "application/javascript; charset=utf-8" },
    };

    [PluginEntryPoint]
    public static void Main() {
        try {
            var pluginDir = API.GetPluginDirectory(typeof(MHWildsWebAPI).Assembly);
            s_webRoot = Path.Combine(pluginDir, "WebAPI");

            if (!Directory.Exists(s_webRoot)) {
                API.LogError($"[WebAPI] WebAPI folder not found at {s_webRoot}");
                return;
            }

            s_listener = new HttpListener();
            s_listener.Prefixes.Add($"http://localhost:{s_port}/");
            s_listener.Start();

            s_thread = new Thread(ListenLoop) { IsBackground = true };
            s_thread.Start();

            API.LogInfo($"[WebAPI] Listening on http://localhost:{s_port}/ (serving from {s_webRoot})");
        } catch (Exception e) {
            API.LogError("[WebAPI] Failed to start: " + e.Message);
        }
    }

    [PluginExitPoint]
    public static void OnUnload() {
        s_cts.Cancel();
        s_listener?.Stop();
        s_thread?.Join(2000);
        s_listener?.Close();
        API.LogInfo("[WebAPI] Stopped");
    }

    static void ListenLoop() {
        while (!s_cts.IsCancellationRequested) {
            try {
                var ctx = s_listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
            } catch (HttpListenerException) {
                break;
            } catch (ObjectDisposedException) {
                break;
            }
        }
    }

    static void HandleRequest(HttpListenerContext ctx) {
        try {
            var path = ctx.Request.Url.AbsolutePath.TrimEnd('/').ToLower();

            // API endpoints
            if (path.StartsWith("/api")) {
                object result = path switch {
                    "/api" => GetIndex(),
                    "/api/player" => GetPlayerInfo(),
                    "/api/camera" => GetCameraInfo(),
                    "/api/tdb" => GetTDBStats(),
                    "/api/singletons" => GetSingletonList(),
                    _ => null
                };

                if (result == null) {
                    ctx.Response.StatusCode = 404;
                    WriteJson(ctx.Response, new { error = "Not found" });
                    return;
                }

                WriteJson(ctx.Response, result);
                return;
            }

            // Static file serving
            ServeFile(ctx, path);
        } catch (Exception e) {
            ctx.Response.StatusCode = 500;
            WriteJson(ctx.Response, new { error = e.Message });
        } finally {
            // Clean up thread-local managed objects created by game API calls.
            // Must be called after work is done, not before — otherwise objects
            // from the current request leak until this thread handles another request.
            API.LocalFrameGC();
        }
    }

    static void ServeFile(HttpListenerContext ctx, string path) {
        if (path == "" || path == "/") path = "/index.html";

        // Sanitize: only allow filenames directly in WebAPI folder
        var fileName = Path.GetFileName(path);
        var filePath = Path.Combine(s_webRoot, fileName);

        if (!File.Exists(filePath)) {
            ctx.Response.StatusCode = 404;
            WriteJson(ctx.Response, new { error = "Not found" });
            return;
        }

        var ext = Path.GetExtension(fileName).ToLower();
        ctx.Response.ContentType = s_mimeTypes.GetValueOrDefault(ext, "application/octet-stream");
        var bytes = File.ReadAllBytes(filePath);
        ctx.Response.OutputStream.Write(bytes);
        ctx.Response.Close();
    }

    static void WriteJson(HttpListenerResponse response, object data) {
        response.ContentType = "application/json";
        response.Headers.Add("Access-Control-Allow-Origin", "*");
        var json = JsonSerializer.SerializeToUtf8Bytes(data, new JsonSerializerOptions { WriteIndented = true });
        response.OutputStream.Write(json);
        response.Close();
    }

    static object GetIndex() {
        return new {
            name = "MHWilds REFramework.NET Web API",
            endpoints = new[] { "/api/player", "/api/camera", "/api/tdb", "/api/singletons" }
        };
    }

    static object GetPlayerInfo() {
        var pm = API.GetManagedSingletonT<app.PlayerManager>();
        if (pm == null) return new { error = "PlayerManager not available" };

        var player = pm.getMasterPlayer();
        if (player == null) return new { error = "Player is null" };

        var ctx = player.ContextHolder;
        var pl = ctx.Pl;

        float? posX = null, posY = null, posZ = null;
        try {
            var go = player.Object;
            if (go != null) {
                var tf = go.Transform;
                if (tf != null) {
                    var pos = tf.Position;
                    posX = pos.x; posY = pos.y; posZ = pos.z;
                }
            }
        } catch { }

        float? health = null, maxHealth = null;
        try {
            var hm = ctx.Chara.HealthManager;
            if (hm != null) {
                health = hm._Health.read();
                maxHealth = hm._MaxHealth.read();
            }
        } catch { }

        return new {
            name = pl._PlayerName?.ToString(),
            level = (int)pl._CurrentStage,
            health,
            maxHealth,
            position = new { x = posX, y = posY, z = posZ },
            generalPos = new { x = pl._GeneralPos.x, y = pl._GeneralPos.y, z = pl._GeneralPos.z },
            distToCamera = pl._DistToCamera,
            isMasterRow = pl._NetMemberInfo.IsMasterRow
        };
    }

    static object GetCameraInfo() {
        try {
            var camera = via.SceneManager.MainView.PrimaryCamera;
            if (camera == null) return new { error = "No primary camera" };

            var tf = camera.GameObject.Transform;
            var pos = tf.Position;

            return new {
                position = new { x = pos.x, y = pos.y, z = pos.z },
                fov = camera.FOV,
                nearClip = camera.NearClipPlane,
                farClip = camera.FarClipPlane
            };
        } catch (Exception e) {
            return new { error = e.Message };
        }
    }

    static object GetTDBStats() {
        var tdb = TDB.Get();
        return new {
            types = tdb.GetNumTypes(),
            methods = tdb.GetNumMethods(),
            fields = tdb.GetNumFields(),
            properties = tdb.GetNumProperties(),
            stringsKB = tdb.GetStringsSize() / 1024,
            rawDataKB = tdb.GetRawDataSize() / 1024
        };
    }

    static object GetSingletonList() {
        var singletons = API.GetManagedSingletons();
        singletons.RemoveAll(s => s.Instance == null);

        var list = new List<object>();
        foreach (var desc in singletons) {
            var instance = desc.Instance;
            var tdef = instance.GetTypeDefinition();
            list.Add(new {
                type = tdef.GetFullName(),
                address = "0x" + instance.GetAddress().ToString("X"),
                methods = (int)tdef.GetNumMethods(),
                fields = (int)tdef.GetNumFields()
            });
        }

        return new { count = list.Count, singletons = list };
    }
}
