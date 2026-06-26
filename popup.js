// 우편번호 검색 확장 프로그램

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsDiv = document.getElementById('results');
const loadingIndicator = document.getElementById('loadingIndicator');

// Enter 키 이벤트
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// 검색 버튼 클릭
searchBtn.addEventListener('click', performSearch);

// 검색 수행
async function performSearch() {
  const query = searchInput.value.trim();
  
  if (!query) {
    showError('검색어를 입력해주세요.');
    return;
  }

  showLoading(true);
  resultsDiv.innerHTML = '';

  try {
    const results = await searchZipcode(query);
    displayResults(results);
  } catch (error) {
    showError('검색 중 오류가 발생했습니다: ' + error.message);
  } finally {
    showLoading(false);
  }
}

// 우편번호 검색 함수
async function searchZipcode(query) {
  const searchUrl = 'https://www.epost.go.kr/search.RetrieveIntegrationNewZipCdList.comm';
  
  try {
    // 실제 폼데이터 구성
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
      keyword: query
    });
    
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: formData.toString()
    });
    
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status}`);
    }
    
    const html = await response.text();
    console.log('응답 받음, HTML 길이:', html.length);
    console.log('HTML 샘플:', html.substring(0, 500));
    
    return parseSearchResults(html);
  } catch (error) {
    console.error('검색 오류:', error);
    throw new Error(`검색 실패: ${error.message}`);
  }
}

// HTML에서 검색 결과 파싱
function parseSearchResults(html) {
  const results = [];
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 실제 HTML 구조: <tr class="title2">에 결과가 있음
    const rows = doc.querySelectorAll('tr.title2');
    
    console.log('찾은 결과 행 수:', rows.length);
    
    rows.forEach((row, index) => {
      try {
        // 우편번호: <th scope="row">
        const zipcodeElement = row.querySelector('th[scope="row"]');
        const zipcode = zipcodeElement ? zipcodeElement.textContent.trim() : '';
        
        // 주소: <td class="t_a_l l_h_18">
        const addressElement = row.querySelector('td.t_a_l.l_h_18');
        if (addressElement) {
          // br 태그로 구분된 두 줄
          const addressText = addressElement.innerHTML;
          const addresses = addressText.split('<br>').map(addr => {
            // HTML 태그 제거
            const temp = document.createElement('div');
            temp.innerHTML = addr;
            return temp.textContent.trim();
          });
          
          const roadAddress = addresses[0] || '';
          const jibunAddress = addresses[1] || '';
          
          if (zipcode && roadAddress) {
            results.push({
              zipcode,
              roadAddress,
              jibunAddress
            });
          }
        }
      } catch (error) {
        console.error(`행 ${index} 파싱 오류:`, error);
      }
    });
    
    console.log('파싱된 결과 수:', results.length);
  } catch (error) {
    console.error('전체 파싱 오류:', error);
  }
  
  return results;
}

// 결과 표시
function displayResults(results) {
  if (!results || results.length === 0) {
    resultsDiv.innerHTML = '<div class="no-results">검색 결과가 없습니다.</div>';
    return;
  }

  resultsDiv.innerHTML = results.map(result => `
    <div class="result-item" onclick="copyAddress(this)">
      <div class="zipcode">${result.zipcode}</div>
      <div class="address">${result.roadAddress}</div>
      ${result.jibunAddress ? `<div class="old-address">(지번) ${result.jibunAddress}</div>` : ''}
    </div>
  `).join('');
}

// 주소 복사 함수
window.copyAddress = function(element) {
  const zipcode = element.querySelector('.zipcode').textContent.trim();
  const text = zipcode;
  
  navigator.clipboard.writeText(text).then(() => {
    showCopyNotification();
  }).catch(err => {
    console.error('복사 실패:', err);
  });
};

// 복사 알림 표시
function showCopyNotification() {
  const notification = document.createElement('div');
  notification.className = 'copy-notification';
  notification.textContent = '클립보드에 복사되었습니다';
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 2000);
}

// 로딩 표시
function showLoading(show) {
  if (show) {
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

// 에러 표시
function showError(message) {
  resultsDiv.innerHTML = `<div class="error">${message}</div>`;
}

// 초기 포커스
searchInput.focus();