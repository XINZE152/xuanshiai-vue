#!/usr/bin/env python3
"""从 data/location.json 生成两份前端字典，并写回目标文件。

1. utils/profile-field-display.uts 的 LOCATION_NAME_TABLE
   扁平「码 → 名」表，供主包展示层兜底（市辖区已解析为省名）。
2. pagesSub/userExtra/data/location.uts 的 LOCATION_TREE_RAW
   省/市/区三级树，供 userExtra 分包的级联选择器。

两份都必须是**字符串常量**：直接 `import '@/data/location.json'` 会让 UTS
把嵌套 JSON 编译成 UTSJSONObject 字面量（约 404 KB），并被提升到主包根目录的
location.js，把省下来的包体积又吃回去。

用法：
    python scripts/gen-location-table.py            # 只校验是否过期
    python scripts/gen-location-table.py --write    # 写回两份
"""
import argparse
import io
import json
import os
import re
import sys

LOCATION_JSON = 'data/location.json'
FLAT_UTS = 'utils/profile-field-display.uts'
TREE_UTS = 'pagesSub/userExtra/data/location.uts'

FLAT_MARK = 'const LOCATION_NAME_TABLE: string = '
TREE_MARK = 'const LOCATION_TREE_RAW: string = '


def build():
    data = json.load(io.open(LOCATION_JSON, encoding='utf-8'))
    flat = []
    seen = set()
    tree_parts = []

    def put(code, name):
        if code in seen:
            return
        seen.add(code)
        flat.append('%s:%s' % (code, name))

    for prov in data:
        pcode, pname = str(prov['code']), prov['name']
        put(pcode, pname)
        seg = ['%s %s' % (pcode, pname)]
        for city in prov.get('city') or []:
            ccode, cname = str(city['code']), city['name']
            put(ccode, pname if cname == '市辖区' else cname)
            ctok = ['%s %s' % (ccode, cname)]
            for area in city.get('area') or []:
                acode = str(area['code'])
                put(acode, area['name'])
                ctok.append('%s %s' % (acode, area['name']))
            seg.append(','.join(ctok))
        tree_parts.append(';'.join(seg))

    return ','.join(flat), '|'.join(tree_parts), len(flat)


UTS_HEADER = '''// 由 scripts/gen-location-table.py 从 data/location.json 生成，请勿手改。
//
// 只服务 pagesSub/userExtra 的省/市/区级联选择器。刻意用紧凑字符串 + 运行时解析，
// 而不是 import 那份嵌套 JSON：JSON 会被 UTS 编译成约 404 KB 的 UTSJSONObject 字面量，
// 并且被提升到主包根目录，直接顶爆 2 MB 主包限制。
//
// 编码：省之间 '|'；省内首段为省「码 名」，其后 ';' 分隔市；市「码 名」后 ',' 分隔区县。
'''


def render_tree(tree_raw):
    return (UTS_HEADER + "\n" + TREE_MARK + "'" + tree_raw + "'\n\n" + """
function parseLocationTree(): any[] {
	const provinces: any[] = []
	for (const provStr of LOCATION_TREE_RAW.split('|')) {
		const segments = provStr.split(';')
		const head = segments[0].split(' ')
		const cities: any[] = []
		for (let i = 1; i < segments.length; i++) {
			const parts = segments[i].split(',')
			const cityHead = parts[0].split(' ')
			const areas: any[] = []
			for (let j = 1; j < parts.length; j++) {
				const areaHead = parts[j].split(' ')
				areas.push({ name: areaHead[1], code: areaHead[0] })
			}
			cities.push({ name: cityHead[1], code: cityHead[0], area: areas })
		}
		provinces.push({ name: head[1], code: head[0], city: cities })
	}
	return provinces
}

/** 省 → 市（city 字段）→ 区县（area 字段）三级树，形状与原 data/location.json 一致。 */
export const LOCATION_TREE: any[] = parseLocationTree()
""")


FLAT_DOC = '''// 行政区划码 → 名称的扁平表，由 data/location.json 生成（scripts/gen-location-table.py）。
// 直接 import 那份 205 KB 的嵌套 JSON 会让 UTS 编译产物膨胀成 411 KB 的 UTSJSONObject
// 字面量并留在主包；扁平字符串把同一份信息压到约 63 KB。嵌套树仍由 userExtra 分包
// 的省/市/区级联选择器各自 import，不进主包。
'''


def patch_flat(src, flat):
    m = re.search(re.escape(FLAT_MARK) + r"'([^']*)'", src)
    if m:
        if m.group(1) == flat:
            return src, 'OK'
        return src[:m.start(1)] + flat + src[m.end(1):], 'WROTE'
    old = "import locationJson from '@/data/location.json'\n"
    if old not in src:
        raise SystemExit('profile-field-display.uts 既无扁平表也找不到原 JSON import')
    new = FLAT_DOC + FLAT_MARK + "'" + flat + "'\n"
    return src.replace(old, new), 'CREATED'


def patch_city_fn(src):
    """把遍历嵌套树的 cityNameByCode 换成扁平表查表。"""
    marker = '/** 城市码 → 城市名。匹配市/区/省级码；直辖市「市辖区」回落省名。 */'
    if marker not in src:
        return src
    end = src.index('/**\n * 省/市/区编码')
    new_fn = """/**
 * 行政区划码 → 名称。直辖市下的「市辖区」在生成表时已解析为省名，
 * 所以这里查到的就是最终展示用名，查不到返回空串（调用方按层级退化）。
 */
let LOCATION_NAME_MAP: Map<string, string> | null = null

function locationNameMap(): Map<string, string> {
	const cached = LOCATION_NAME_MAP
	if (cached != null) return cached
	const map: Map<string, string> = new Map()
	const items: string[] = LOCATION_NAME_TABLE.split(',')
	for (const item of items) {
		const sep = item.indexOf(':')
		if (sep > 0) map.set(item.substring(0, sep), item.substring(sep + 1))
	}
	LOCATION_NAME_MAP = map
	return map
}

/** 城市码 → 城市名。匹配省/市/区三级编码。 */
export function cityNameByCode(code: any): string {
	const target = '' + code
	if (target == '') return ''
	const hit = locationNameMap().get(target)
	return hit != null ? hit : ''
}

"""
    return src[:src.index(marker)] + new_fn + src[end:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()

    flat, tree, count = build()

    if not args.write:
        rc = 0
        for path, marker, value in ((FLAT_UTS, FLAT_MARK, flat), (TREE_UTS, TREE_MARK, tree)):
            src = io.open(path, encoding='utf-8').read() if os.path.isfile(path) else ''
            m = re.search(re.escape(marker) + r"'([^']*)'", src)
            if m and m.group(1) == value:
                print('OK      %s' % path)
            else:
                print('STALE   %s' % path)
                rc = 1
        return rc

    src = io.open(FLAT_UTS, encoding='utf-8').read()
    src, state = patch_flat(src, flat)
    src = patch_city_fn(src)
    if state != 'OK':
        io.open(FLAT_UTS, 'w', encoding='utf-8', newline='').write(src)
    print('%s %s (%d 条码)' % (state, FLAT_UTS, count))

    if os.path.isfile(TREE_UTS):
        tsrc = io.open(TREE_UTS, encoding='utf-8').read()
        m = re.search(re.escape(TREE_MARK) + r"'([^']*)'", tsrc)
        if m and m.group(1) == tree:
            state = 'OK'
        else:
            io.open(TREE_UTS, 'w', encoding='utf-8', newline='').write(render_tree(tree))
            state = 'WROTE'
    else:
        io.open(TREE_UTS, 'w', encoding='utf-8', newline='').write(render_tree(tree))
        state = 'CREATED'
    print('%s %s (%d 字节紧凑树)' % (state, TREE_UTS, len(tree.encode('utf-8'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
