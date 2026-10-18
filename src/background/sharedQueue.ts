import { LIMITS } from '@/lib/protocol'
import { setQueued } from './badge'
import { RequestQueue } from './queue'

/** v1 세션과 허브 플러그인이 함께 쓰는 조회 큐. 두 경로의 우체국 요청 간격(minIntervalMs)이 함께 지켜진다(팝업 검색은 자체 간격을 쓴다) */
export const queue = new RequestQueue({ minIntervalMs: LIMITS.minIntervalMs, maxLength: LIMITS.maxQueue, onChange: setQueued })
