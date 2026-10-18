import { LIMITS } from '@/lib/protocol'
import { setQueued } from './badge'
import { RequestQueue } from './queue'

/** 팝업·v1 세션·허브 플러그인이 함께 쓰는 조회 큐. 우체국 요청 간격(minIntervalMs)이 경로와 무관하게 지켜진다 */
export const queue = new RequestQueue({ minIntervalMs: LIMITS.minIntervalMs, maxLength: LIMITS.maxQueue, onChange: setQueued })
