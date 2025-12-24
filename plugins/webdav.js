"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webdav_1 = require("webdav");
let cachedData = {};
function getClient() {
    var _a, _b, _c;
    const { url, username, password, searchPath } = (_b = (_a = env === null || env === void 0 ? void 0 : env.getUserVariables) === null || _a === void 0 ? void 0 : _a.call(env)) !== null && _b !== void 0 ? _b : {};
    if (!(url && username && password)) {
        return null;
    }
    if (!(cachedData.url === url &&
        cachedData.username === username &&
        cachedData.password === password &&
        cachedData.searchPath === searchPath)) {
        cachedData.url = url;
        cachedData.username = username;
        cachedData.password = password;
        cachedData.searchPath = searchPath;
        cachedData.searchPathList = (_c = searchPath === null || searchPath === void 0 ? void 0 : searchPath.split) === null || _c === void 0 ? void 0 : _c.call(searchPath, ",");
        cachedData.cacheFileList = null;
    }
    return (0, webdav_1.createClient)(url, {
        authType: webdav_1.AuthType.Password,
        username,
        password,
    });
}

async function scanDirRecursive(client, dir, result) {
    let items;
    try {
        items = await client.getDirectoryContents(dir);
    } catch (e) {
        return;
    }

    for (const it of items) {
        if (it.type === "file" && it.mime && it.mime.startsWith("audio")) {
            result.push(it);
        } else if (it.type === "directory") {
            await scanDirRecursive(client, it.filename, result);
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

        for (let search of searchPathList) {
            await scanDirRecursive(client, search, result);
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


    let result = [];
    await scanDirRecursive(client, topListItem.id, result);

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
    description: "使用此插件前先配置用户变量",
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
    ],
    version: "0.0.3",
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