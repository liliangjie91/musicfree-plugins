"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webdav_1 = require("webdav");
const mm = require('music-metadata'); // 用于解析音乐文件元数据
let cachedData = {};
function getClient() {
    var _a, _b, _c;
    // const { url, username, password, searchPath, maxDepth } = (_b = (_a = env === null || env === void 0 ? void 0 : env.getUserVariables) === null || _a === void 0 ? void 0 : _a.call(env)) !== null && _b !== void 0 ? _b : {};
    const { url, username, password, searchPath, maxDepth, getMeta } = env?.getUserVariables?.() ?? {};
    if (!(url && username && password)) {
        return null;
    }
    const depth = parseInt(maxDepth, 10);
    const parsedDepth = Number.isNaN(depth) ? 5 : depth;
    const parsedGetMeta = getMeta === "true";

    if (!(cachedData.url === url &&
        cachedData.username === username &&
        cachedData.password === password &&
        cachedData.searchPath === searchPath &&
        cachedData.maxDepth === parsedDepth &&
        cachedData.getMeta === parsedGetMeta)) {
        cachedData.url = url;
        cachedData.username = username;
        cachedData.password = password;
        cachedData.searchPath = searchPath;
        cachedData.maxDepth = parsedDepth;
        cachedData.getMeta = parsedGetMeta;
        cachedData.searchPathList = (_c = searchPath === null || searchPath === void 0 ? void 0 : searchPath.split) === null || _c === void 0 ? void 0 : _c.call(searchPath, ",");
        cachedData.cacheFileList = null;
    }
    return (0, webdav_1.createClient)(url, {
        authType: webdav_1.AuthType.Password,
        username,
        password,
    });
}

// 读取远端文件前 N 字节到 Buffer（客户端请求的并发需外部控制）
async function readFirstBytes(client, path, maxBytes) {
    // 优先使用带范围的读取（若 webdav 客户端/服务端支持），避免请求整个文件
    const end = Math.max(0, maxBytes - 1);
    return new Promise((resolve, reject) => {
        const chunks = [];
        let stream;
        try {
            // 有些 webdav 实现支持 start/end 参数（之前版本使用过），优先使用它
            stream = client.createReadStream(path, { start: 0, end });
        } catch (err) {
            return reject(err);
        }

        stream.on('data', (chunk) => {
            chunks.push(chunk);
        });

        stream.on('end', () => {
            const buf = Buffer.concat(chunks);
            // 如果服务器返回的字节比请求的多（极少见），只截取前 maxBytes 字节
            resolve(buf.length > maxBytes ? buf.slice(0, maxBytes) : buf);
        });

        stream.on('error', (err) => {
            reject(err);
        });
    });
}

// 从单个 fileItem 获取元数据（包含缓存逻辑）
async function fetchMetaForItem(client, item, maxMetaBytes) {
    // 如果已经缓存，直接使用
    if (cachedData.fileInfoCache?.[item.filename]) {
        return cachedData.fileInfoCache[item.filename];
    }

    try {
        const buffer = await readFirstBytes(client, item.filename, maxMetaBytes);
        const metadata = await mm.parseBuffer(buffer, undefined, { duration: true, skipCovers: true });

        const info = {
            title: (metadata && metadata.common && metadata.common.title) || item.basename,
            artist: (metadata && metadata.common && metadata.common.artist) || "未知作者",
            album: (metadata && metadata.common && metadata.common.album) || "未知专辑",
            // duration: (metadata && metadata.format && metadata.format.duration) || 0,
            id: item.filename,
        };

        cachedData.fileInfoCache = cachedData.fileInfoCache || {};
        cachedData.fileInfoCache[item.filename] = info;
        // console.log(`Fetched metadata for ${item.basename}:`, info);
        return info;
    } catch (e) {
        return {
            title: item.basename,
            artist: "未知作者",
            album: "未知专辑",
            // duration: 0,
            id: item.filename,
        };
    }
}

// 并发分块实现：对 fileItems 按块并发处理（每块内并发），块之间串行
async function getMusicInfoBatchChunked(client, fileItems, concurrency = 3, maxMetaBytes = 128 * 1024) {
    const results = new Array(fileItems.length);
    for (let i = 0; i < fileItems.length; i += concurrency) {
        const chunk = fileItems.slice(i, i + concurrency);
        const promises = chunk.map((item) => fetchMetaForItem(client, item, maxMetaBytes));
        const metas = await Promise.all(promises);
        for (let j = 0; j < metas.length; j++) {
            results[i + j] = metas[j];
        }
    }
    return results;
}

// 顺序实现：一个一个处理，最保守但最稳健
async function getMusicInfoBatchSequential(client, fileItems, maxMetaBytes = 128 * 1024) {
    const results = [];
    for (let i = 0; i < fileItems.length; i++) {
        const item = fileItems[i];
        const meta = await fetchMetaForItem(client, item, maxMetaBytes);
        results[i] = meta;
    }
    return results;
}

// 默认导出的兼容函数：使用 chunked 实现（可以改成调用 sequential）
async function getMusicInfoBatch(client, fileItems) {
    // 默认并发数，若需要可在 userVariables 中暴露或修改为其它值
    const DEFAULT_CONCURRENCY = 3;
    return await getMusicInfoBatchChunked(client, fileItems, DEFAULT_CONCURRENCY);
}

async function outputMusic(client, fileItems) {
    if (cachedData.getMeta) {
        return await getMusicInfoBatch(client, fileItems);
    } else {
        return fileItems.map((it) => ({
            title: it.basename,
            id: it.filename,
            artist: "未知作者",
            album: "未知专辑",
        }));
    }
}

async function scanDirRecursive(client, dir, result, depth, maxDepth, visited) {
    if (visited.has(dir)) return;
    visited.add(dir);

    if (maxDepth >= 0 && depth > maxDepth) return;

    let items;
    try {
        items = await client.getDirectoryContents(dir);
    } catch {
        return;
    }

    for (const it of items) {
        if (it.type === "file" && it.mime?.startsWith("audio")) {
            result.push(it);
        } else if (it.type === "directory") {
            await scanDirRecursive(client,it.filename,result,depth + 1,maxDepth,visited);
        }
    }
}


async function searchMusic(query) {
    var _a, _b;
    const client = getClient();
    if (!client) return { isEnd: true, data: [] };

    if (!cachedData.cacheFileList) {
        const searchPathList = ((_a = cachedData.searchPathList) === null || _a === void 0 ? void 0 : _a.length)
            ? cachedData.searchPathList
            : ["/"];

        let result = [];
        const visited = new Set();
        for (let search of searchPathList) {
            await scanDirRecursive(client, search, result, 0, cachedData.maxDepth, visited);
        }

        cachedData.cacheFileList = result;
    }

    return {
        isEnd: true,
        data: ((_b = cachedData.cacheFileList) ?? [])
            .filter((it) => it.basename.includes(query))
            .map((it) => ({
                title: it.basename,
                id: it.filename,
                artist: "未知作者",
                album: "未知专辑",
            })),
    };
}
async function getTopLists() {
    getClient();
    const data = {
        title: "全部歌曲",
        data: (cachedData.searchPathList || []).map((it) => ({
            title: it,
            id: it,
        })),
    };
    return [data];
}
async function getTopListDetail(topListItem) {
    const client = getClient();

    const visited = new Set();
    let result = [];
    await scanDirRecursive(client, topListItem.id, result, 0, cachedData.maxDepth, visited);

    return {
        musicList: await outputMusic(client, result),
    };

}
module.exports = {
    platform: "WebDAV-R",
    author: "laowo",
    description: "使用此插件前先配置用户变量；存放歌曲的路径可用英文逗号分隔多个；最大扫描深度(-1:无限,0:仅当前目录,默认5)",
    userVariables: [
        {
            key: "url",
            name: "WebDAV地址",
        },
        {
            key: "username",
            name: "用户名",
        },
        {
            key: "password",
            name: "密码",
            type: "password",
        },
        {
            key: "searchPath",
            name: "存放歌曲的路径",
        },
        {
            key: "maxDepth",
            name: "最大扫描深度",
        },
        {
            key: "getMeta",
            name: "是否获取元数据",
        }
    ],
    version: "0.1.3",
    supportedSearchType: ["music"],
    // srcUrl: "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/webdav/index.js",
    srcUrl: "https://raw.githubusercontent.com/liliangjie91/musicfree-plugins/main/plugins/webdav.js",
    cacheControl: "no-cache",
    search(query, page, type) {
        if (type === "music") {
            return searchMusic(query);
        }
    },
    getTopLists,
    getTopListDetail,
    getMediaSource(musicItem) {
        const client = getClient();
        return {
            url: client.getFileDownloadLink(musicItem.id),
        };
    },
};