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
                var method = ctx.Request.HttpMethod;

                // POST endpoints
                if (method == "POST") {
                    object postResult = path switch {
                        "/api/player/health" => SetPlayerHealth(ctx.Request),
                        _ => null
                    };

                    if (postResult == null) {
                        ctx.Response.StatusCode = 404;
                        WriteJson(ctx.Response, new { error = "Not found" });
                        return;
                    }

                    WriteJson(ctx.Response, postResult);
                    return;
                }

                // GET endpoints
                object result = path switch {
                    "/api" => GetIndex(),
                    "/api/player" => GetPlayerInfo(),
                    "/api/camera" => GetCameraInfo(),
                    "/api/tdb" => GetTDBStats(),
                    "/api/singletons" => GetSingletonList(),
                    "/api/explorer/singletons" => GetExplorerSingletons(),
                    "/api/explorer/object" => GetExplorerObject(ctx.Request),
                    "/api/explorer/field" => GetExplorerField(ctx.Request),
                    "/api/explorer/method" => GetExplorerMethod(ctx.Request),
                    "/api/explorer/array" => GetExplorerArray(ctx.Request),
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
            endpoints = new[] { "/api/player", "/api/camera", "/api/tdb", "/api/singletons",
                "/api/explorer/singletons", "/api/explorer/object", "/api/explorer/field",
                "/api/explorer/method", "/api/explorer/array" }
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

    static object SetPlayerHealth(HttpListenerRequest request) {
        using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
        var body = reader.ReadToEnd();
        var doc = JsonDocument.Parse(body);
        var value = doc.RootElement.GetProperty("value").GetSingle();

        var pm = API.GetManagedSingletonT<app.PlayerManager>();
        if (pm == null) return new { error = "PlayerManager not available" };

        var player = pm.getMasterPlayer();
        if (player == null) return new { error = "Player is null" };

        var hm = player.ContextHolder.Chara.HealthManager;
        if (hm == null) return new { error = "HealthManager not available" };

        hm._Health.write(value);
        return new { ok = true, health = value };
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

    // ── Explorer helpers ──────────────────────────────────────────────

    static readonly TypeDefinition s_systemArrayT = TDB.Get().GetType("System.Array");

    static IObject ResolveObject(HttpListenerRequest request) {
        var qs = request.QueryString;
        var addressStr = qs["address"];
        var kind = qs["kind"];
        var typeName = qs["typeName"];

        if (string.IsNullOrEmpty(addressStr) || string.IsNullOrEmpty(kind) || string.IsNullOrEmpty(typeName))
            return null;

        ulong address = 0;
        if (addressStr.StartsWith("0x") || addressStr.StartsWith("0X"))
            address = Convert.ToUInt64(addressStr.Substring(2), 16);
        else
            address = Convert.ToUInt64(addressStr, 16);

        if (address == 0) return null;

        if (kind == "managed") {
            return ManagedObject.ToManagedObject(address);
        } else if (kind == "native") {
            var tdef = TDB.Get().GetType(typeName);
            if (tdef == null) return null;
            return new NativeObject(address, tdef);
        }

        return null;
    }

    static string ReadFieldValueAsString(IObject obj, Field field, TypeDefinition ft) {
        var finalName = ft.IsEnum() ? ft.GetUnderlyingType().GetFullName() : ft.GetFullName();

        object fieldData = null;
        switch (finalName) {
            case "System.Byte":
                fieldData = field.GetDataT<byte>(obj.GetAddress(), false);
                break;
            case "System.SByte":
                fieldData = field.GetDataT<sbyte>(obj.GetAddress(), false);
                break;
            case "System.Int16":
                fieldData = field.GetDataT<short>(obj.GetAddress(), false);
                break;
            case "System.UInt16":
                fieldData = field.GetDataT<ushort>(obj.GetAddress(), false);
                break;
            case "System.Int32":
                fieldData = field.GetDataT<int>(obj.GetAddress(), false);
                break;
            case "System.UInt32":
                fieldData = field.GetDataT<uint>(obj.GetAddress(), false);
                break;
            case "System.Int64":
                fieldData = field.GetDataT<long>(obj.GetAddress(), false);
                break;
            case "System.UInt64":
                fieldData = field.GetDataT<ulong>(obj.GetAddress(), false);
                break;
            case "System.Single":
                fieldData = field.GetDataT<float>(obj.GetAddress(), false);
                break;
            case "System.Boolean":
                fieldData = field.GetDataT<bool>(obj.GetAddress(), false);
                break;
            default:
                return null;
        }

        if (fieldData == null) return null;

        if (ft.IsEnum()) {
            long longValue = Convert.ToInt64(fieldData);
            try {
                var boxedEnum = _System.Enum.InternalBoxEnum(ft.GetRuntimeType().As<_System.RuntimeType>(), longValue);
                return (boxedEnum as IObject).Call("ToString()") + " (" + fieldData.ToString() + ")";
            } catch {
                return fieldData.ToString();
            }
        }

        return fieldData.ToString();
    }

    // ── Explorer endpoints ────────────────────────────────────────────

    static object GetExplorerSingletons() {
        var managedList = new List<object>();
        var nativeList = new List<object>();

        try {
            var managed = API.GetManagedSingletons();
            managed.RemoveAll(s => s.Instance == null);
            managed.Sort((a, b) => a.Instance.GetTypeDefinition().GetFullName()
                .CompareTo(b.Instance.GetTypeDefinition().GetFullName()));

            foreach (var desc in managed) {
                var instance = desc.Instance;
                var tdef = instance.GetTypeDefinition();
                managedList.Add(new {
                    type = tdef.GetFullName(),
                    address = "0x" + instance.GetAddress().ToString("X"),
                    kind = "managed"
                });
            }
        } catch { }

        try {
            var native = API.GetNativeSingletons();
            native.Sort((a, b) => a.Instance.GetTypeDefinition().GetFullName()
                .CompareTo(b.Instance.GetTypeDefinition().GetFullName()));

            foreach (var desc in native) {
                var instance = desc.Instance;
                if (instance == null) continue;
                var tdef = instance.GetTypeDefinition();
                nativeList.Add(new {
                    type = tdef.GetFullName(),
                    address = "0x" + instance.GetAddress().ToString("X"),
                    kind = "native"
                });
            }
        } catch { }

        return new { managed = managedList, native = nativeList };
    }

    static object GetExplorerObject(HttpListenerRequest request) {
        try {
            var obj = ResolveObject(request);
            if (obj == null) return new { error = "Could not resolve object" };

            var tdef = obj.GetTypeDefinition();
            var typeName = tdef.GetFullName();

            int? refCount = null;
            if (obj is ManagedObject managed) {
                refCount = managed.GetReferenceCount();
            }

            // Collect fields from type hierarchy
            var fields = new List<Field>();
            for (var parent = tdef; parent != null; parent = parent.ParentType) {
                fields.AddRange(parent.GetFields());
            }
            fields.Sort((a, b) => a.GetName().CompareTo(b.GetName()));

            var fieldList = new List<object>();
            foreach (var field in fields) {
                var ft = field.GetType();
                var ftName = ft != null ? ft.GetFullName() : "null";
                bool isValueType = ft != null && ft.IsValueType();
                bool isStatic = field.IsStatic();

                string value = null;
                if (ft != null && isValueType) {
                    try { value = ReadFieldValueAsString(obj, field, ft); } catch { }
                }

                ulong fieldAddr = 0;
                if (isStatic) {
                    try { fieldAddr = field.GetDataRaw(obj.GetAddress(), false); } catch { }
                } else {
                    fieldAddr = (obj as UnifiedObject)?.GetAddress() ?? 0;
                    fieldAddr += field.GetOffsetFromBase();
                }

                fieldList.Add(new {
                    name = field.GetName(),
                    typeName = ftName,
                    isValueType,
                    isStatic,
                    offset = isStatic ? (string)null : "0x" + field.GetOffsetFromBase().ToString("X"),
                    value
                });
            }

            // Collect methods from type hierarchy
            var methods = new List<Method>();
            for (var parent = tdef; parent != null; parent = parent.ParentType) {
                methods.AddRange(parent.GetMethods());
            }
            methods.Sort((a, b) => a.GetName().CompareTo(b.GetName()));
            methods.RemoveAll(m => m.GetParameters().Exists(p => p.Type.Name.Contains("!")));

            var methodList = new List<object>();
            foreach (var method in methods) {
                var returnT = method.GetReturnType();
                var returnTName = returnT != null ? returnT.GetFullName() : "void";

                var ps = method.GetParameters();
                var paramList = new List<object>();
                foreach (var p in ps) {
                    paramList.Add(new {
                        type = p.Type.GetFullName(),
                        name = p.Name
                    });
                }

                bool isGetter = (method.Name.StartsWith("get_") || method.Name.StartsWith("Get") || method.Name == "ToString") && ps.Count == 0;

                methodList.Add(new {
                    name = method.GetName(),
                    returnType = returnTName,
                    parameters = paramList,
                    isGetter,
                    signature = method.GetMethodSignature()
                });
            }

            // Check if array
            bool isArray = tdef.IsDerivedFrom(s_systemArrayT);
            int? arrayLength = null;
            if (isArray) {
                try { arrayLength = (int)obj.Call("get_Length"); } catch { }
            }

            return new {
                typeName,
                address = "0x" + (obj as UnifiedObject).GetAddress().ToString("X"),
                refCount,
                fields = fieldList,
                methods = methodList,
                isArray,
                arrayLength
            };
        } catch (Exception e) {
            return new { error = e.Message };
        }
    }

    static object GetExplorerField(HttpListenerRequest request) {
        try {
            var obj = ResolveObject(request);
            if (obj == null) return new { error = "Could not resolve object" };

            var fieldName = request.QueryString["fieldName"];
            if (string.IsNullOrEmpty(fieldName)) return new { error = "fieldName required" };

            var child = obj.GetField(fieldName) as IObject;
            if (child == null) return new { isNull = true };

            var childTdef = child.GetTypeDefinition();
            bool childManaged = child is ManagedObject;

            return new {
                isNull = false,
                childAddress = "0x" + child.GetAddress().ToString("X"),
                childKind = childManaged ? "managed" : "native",
                childTypeName = childTdef.GetFullName()
            };
        } catch (Exception e) {
            return new { error = e.Message };
        }
    }

    static object GetExplorerMethod(HttpListenerRequest request) {
        try {
            var obj = ResolveObject(request);
            if (obj == null) return new { error = "Could not resolve object" };

            var methodName = request.QueryString["methodName"];
            var methodSignature = request.QueryString["methodSignature"];
            if (string.IsNullOrEmpty(methodName)) return new { error = "methodName required" };

            // Find the method by name and optionally signature
            var tdef = obj.GetTypeDefinition();
            Method targetMethod = null;
            for (var parent = tdef; parent != null; parent = parent.ParentType) {
                foreach (var m in parent.GetMethods()) {
                    if (m.GetName() == methodName) {
                        if (!string.IsNullOrEmpty(methodSignature) && m.GetMethodSignature() != methodSignature)
                            continue;
                        targetMethod = m;
                        break;
                    }
                }
                if (targetMethod != null) break;
            }

            if (targetMethod == null) return new { error = "Method not found" };

            // Only invoke getters (0 params, name starts with get_/Get or is ToString)
            var ps = targetMethod.GetParameters();
            if (ps.Count != 0) return new { error = "Method has parameters, cannot invoke" };
            if (!targetMethod.Name.StartsWith("get_") && !targetMethod.Name.StartsWith("Get") && targetMethod.Name != "ToString")
                return new { error = "Method is not a getter" };

            object result = null;
            obj.HandleInvokeMember_Internal(targetMethod, null, ref result);

            if (result == null) return new { isObject = false, value = "null" };

            if (result is IObject objResult) {
                var childTdef = objResult.GetTypeDefinition();
                bool childManaged = objResult is ManagedObject;
                return new {
                    isObject = true,
                    childAddress = "0x" + objResult.GetAddress().ToString("X"),
                    childKind = childManaged ? "managed" : "native",
                    childTypeName = childTdef.GetFullName()
                };
            }

            // Primitive result - check for enum
            var returnType = targetMethod.GetReturnType();
            if (returnType != null && returnType.IsEnum()) {
                long longValue = Convert.ToInt64(result);
                try {
                    var boxedEnum = _System.Enum.InternalBoxEnum(returnType.GetRuntimeType().As<_System.RuntimeType>(), longValue);
                    return new { isObject = false, value = (boxedEnum as IObject).Call("ToString()") + " (" + result.ToString() + ")" };
                } catch { }
            }

            return new { isObject = false, value = result.ToString() };
        } catch (Exception e) {
            return new { error = e.Message };
        }
    }

    static object GetExplorerArray(HttpListenerRequest request) {
        try {
            var obj = ResolveObject(request);
            if (obj == null) return new { error = "Could not resolve object" };

            var tdef = obj.GetTypeDefinition();
            if (!tdef.IsDerivedFrom(s_systemArrayT))
                return new { error = "Object is not an array" };

            int offset = 0;
            int count = 50;
            if (!string.IsNullOrEmpty(request.QueryString["offset"]))
                int.TryParse(request.QueryString["offset"], out offset);
            if (!string.IsNullOrEmpty(request.QueryString["count"]))
                int.TryParse(request.QueryString["count"], out count);

            var easyArray = obj.As<_System.Array>();
            int totalLength = easyArray.Length;

            int end = Math.Min(offset + count, totalLength);
            var elements = new List<object>();

            for (int i = offset; i < end; i++) {
                try {
                    var element = easyArray.GetValue(i);
                    if (element == null) {
                        elements.Add(new { index = i, isNull = true, isObject = false, value = "null" });
                        continue;
                    }

                    if (element is IObject objElement) {
                        string display = null;
                        try { display = objElement.Call("ToString()") as string; } catch { }
                        var elTdef = objElement.GetTypeDefinition();
                        bool elManaged = objElement is ManagedObject;
                        elements.Add(new {
                            index = i,
                            isNull = false,
                            isObject = true,
                            address = "0x" + objElement.GetAddress().ToString("X"),
                            kind = elManaged ? "managed" : "native",
                            typeName = elTdef.GetFullName(),
                            display
                        });
                    } else {
                        elements.Add(new {
                            index = i,
                            isNull = false,
                            isObject = false,
                            value = element.ToString()
                        });
                    }
                } catch {
                    elements.Add(new { index = i, isNull = false, isObject = false, value = "error" });
                }
            }

            return new {
                totalLength,
                offset,
                count = elements.Count,
                hasMore = end < totalLength,
                elements
            };
        } catch (Exception e) {
            return new { error = e.Message };
        }
    }
}
