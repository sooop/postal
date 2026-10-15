// 복사 형식: 우편번호만, 주소만, 우편번호 + 주소 전체.
import type { ZipcodeResult } from './search'

export type CopyFormat = 'zip' | 'address' | 'full'

export const COPY_FORMATS: { value: CopyFormat; label: string; title: string }[] = [
  { value: 'zip', label: '우편번호', title: '우편번호만 복사' },
  { value: 'address', label: '주소', title: '도로명주소만 복사' },
  { value: 'full', label: '전체', title: '우편번호와 도로명주소를 함께 복사' },
]

export const isCopyFormat = (x: unknown): x is CopyFormat => x === 'zip' || x === 'address' || x === 'full'

/** 복사할 문자열. 도로명주소가 없는 결과는 지번주소로 대신한다 */
export function formatCopy(format: CopyFormat, r: Pick<ZipcodeResult, 'zipcode' | 'roadAddress' | 'jibunAddress'>): string {
  const address = r.roadAddress || r.jibunAddress
  if (format === 'address') return address || r.zipcode
  if (format === 'full') return address ? `${r.zipcode} ${address}` : r.zipcode
  return r.zipcode
}
