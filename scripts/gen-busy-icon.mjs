// 툴바 아이콘(Lucide mailbox)을 PNG 로 만든다. 평상시(icon*)와 작동 중(icon-busy*)이 같은 그림이다. 실행: npm run icons:busy
// 16px 은 기본 선 굵기 2 를 그대로 줄이면 1.33px 로 흐려지므로 더 굵게 그린다.
import { writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { __iconNode } from 'lucide-react/dist/esm/icons/mailbox.js'

const COLOR = '#d7141e'
const SIZES = [
  { name: 'icon-busy16', size: 16, stroke: 2.5 },
  { name: 'icon-busy32', size: 32, stroke: 2 },
  { name: 'icon16', size: 16, stroke: 2.5 },
  { name: 'icon48', size: 48, stroke: 2 },
  { name: 'icon128', size: 128, stroke: 2 },
]

function svg(stroke) {
  const body = __iconNode
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')
      return `<${tag} ${a}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${COLOR}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

for (const { name, size, stroke } of SIZES) {
  const png = new Resvg(svg(stroke), { fitTo: { mode: 'width', value: size } }).render().asPng()
  const out = `public/${name}.png`
  writeFileSync(out, png)
  console.log(out, png.length, 'bytes')
}
