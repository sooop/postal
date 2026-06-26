export interface ZipcodeResult {
  zipcode: string
  roadAddress: string
  jibunAddress: string
}

export interface SearchPage {
  results: ZipcodeResult[]
  hasMore: boolean
  nextTargetRow: number
}

export async function searchZipcode(query: string, targetRow = 1): Promise<SearchPage> {
  const searchUrl = 'https://www.epost.go.kr/search.RetrieveIntegrationNewZipCdList.comm'

  const formData = new URLSearchParams({
    targetRow: String(targetRow),
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
  return parseSearchResults(html, targetRow)
}

export function parseSearchResults(html: string, currentTargetRow = 1): SearchPage {
  const results: ZipcodeResult[] = []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const rows = doc.querySelectorAll('tr.title2')

    rows.forEach((row, index) => {
      try {
        const zipcodeElement = row.querySelector('th[scope="row"]')
        const zipcode = zipcodeElement ? (zipcodeElement.textContent?.trim() ?? '') : ''

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

    // 다음 페이지 여부: 페이지 네비에서 현재 targetRow보다 큰 goPage 값이 있는지 확인
    const pageLinks = doc.querySelectorAll('ul.table_num a[onclick]')
    let hasMore = false
    pageLinks.forEach((link) => {
      const onclick = link.getAttribute('onclick') ?? ''
      const m = onclick.match(/goPage\('(\d+)'\)/)
      if (m) {
        const row = parseInt(m[1], 10)
        if (row > currentTargetRow) hasMore = true
      }
    })

    return {
      results,
      hasMore,
      nextTargetRow: currentTargetRow + 10,
    }
  } catch (err) {
    console.error('전체 파싱 오류:', err)
    return { results, hasMore: false, nextTargetRow: currentTargetRow + 10 }
  }
}
