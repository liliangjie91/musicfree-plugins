"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webdav_1 = require("webdav");
let cachedData = {};
function getClient() {
    var _a, _b, _c;
    const { url, username, password, searchPath, maxDepth } = env?.getUserVariables?.() ?? {};
    if (!(url && username && password)) {
        return null;
    }
    const depth = parseInt(maxDepth, 10);
    const parsedDepth = Number.isNaN(depth) ? 5 : depth;

    if (!(cachedData.url === url &&
        cachedData.username === username &&
        cachedData.password === password &&
        cachedData.searchPath === searchPath &&
        cachedData.maxDepth === parsedDepth)) {
        cachedData.url = url;
        cachedData.username = username;
        cachedData.password = password;
        cachedData.searchPath = searchPath;
        cachedData.maxDepth = parsedDepth;
        cachedData.searchPathList = (_c = searchPath === null || searchPath === void 0 ? void 0 : searchPath.split) === null || _c === void 0 ? void 0 : _c.call(searchPath, ",");
        cachedData.cacheFileList = null;
    }
    return (0, webdav_1.createClient)(url, {
        authType: webdav_1.AuthType.Password,
        username,
        password,
    });
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
        musicList: result.map((it) => ({
            title: it.basename,
            id: it.filename,
            artist: "未知作者",
            album: "未知专辑",
        })),
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
        }
    ],
    version: "0.2.0",
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