export interface ZipcodeResult {
  zipcode: string
  roadAddress: string
  jibunAddress: string
}

export async function searchZipcode(query: string): Promise<ZipcodeResult[]> {
  const searchUrl = 'https://www.epost.go.kr/search.RetrieveIntegrationNewZipCdList.comm'

  const formData = new URLSearchParams({
    targetRow: '',
    srchZipCd: '',
    srchSido: '',
    srchSgg: '',
    srchEmdNm: query,
    srchRdNm: '',
    srchRiNm: '',
    srchEtcNm: query,
    srchMaSn: '',
    srchSbSn: '',
    srchPoBoxNm: '',
    srchType: '',
    keyword_type: '',
    accessCnt: '1',
    loginId: 'none',
    keyword: query,
  })

  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: formData.toString(),
  })

  if (!response.ok) {
    throw new Error(`서버 응답 오류: ${response.status}`)
  }

  const html = await response.text()
  return parseSearchResults(html)
}

export function parseSearchResults(html: string): ZipcodeResult[] {
  const results: ZipcodeResult[] = []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const rows = doc.querySelectorAll('tr.title2')

    rows.forEach((row, index) => {
      try {
        const zipcodeElement = row.querySelector('th[scope="row"]')
        const zipcode = zipcodeElement ? zipcodeElement.textContent?.trim() ?? '' : ''

        const addressElement = row.querySelector('td.t_a_l.l_h_18')
        if (addressElement) {
          const addressText = addressElement.innerHTML
          const addresses = addressText.split('<br>').map((addr) => {
            const temp = document.createElement('div')
            temp.innerHTML = addr
            return temp.textContent?.trim() ?? ''
          })

          const roadAddress = addresses[0] ?? ''
          const jibunAddress = addresses[1] ?? ''

          if (zipcode && roadAddress) {
            results.push({ zipcode, roadAddress, jibunAddress })
          }
        }
      } catch (err) {
        console.error(`행 ${index} 파싱 오류:`, err)
      }
    })
  } catch (err) {
    console.error('전체 파싱 오류:', err)
  }

  return results
}
