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

// 批量解析音乐文件信息
async function getMusicInfoBatch(client, fileItems) {
    // 并发限制，避免同时打开太多流
    const CONCURRENCY = 5;
    const results = [];
    let index = 0;

    async function worker() {
        while (index < fileItems.length) {
            const i = index++;
            const item = fileItems[i];

            // 如果已经缓存，直接使用
            if (cachedData.fileInfoCache?.[item.filename]) {
                results[i] = cachedData.fileInfoCache[item.filename];
                continue;
            }

            try {
                const stream = await client.createReadStream(item.filename, { start: 0, end: 128 * 1024 }); // 只读前128KB
                const metadata = await mm.parseStream(stream, { duration: true }, { skipCovers: true });
                stream.destroy();

                const info = {
                    title: metadata.common.title || item.basename,
                    artist: metadata.common.artist || "未知作者",
                    album: metadata.common.album || "未知专辑",
                    duration: metadata.format.duration || 0,
                    id: item.filename,
                };

                // 缓存结果
                cachedData.fileInfoCache = cachedData.fileInfoCache || {};
                cachedData.fileInfoCache[item.filename] = info;

                results[i] = info;
            } catch (e) {
                results[i] = {
                    title: item.basename,
                    artist: "未知作者",
                    album: "未知专辑",
                    duration: 0,
                    id: item.filename,
                };
            }
        }
    }

    // 启动并发 worker
    const workers = Array(CONCURRENCY).fill(null).map(() => worker());
    await Promise.all(workers);

    return results;
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
    version: "0.1.1",
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