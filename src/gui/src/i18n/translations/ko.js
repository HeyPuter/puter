/**
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Translator note: It depends on the overall tone you are going for, however I would suggest changing verbs ending in 십시오 to 세요 for a more modern, user-friendly tone that aligns with conversational UI trends.
// Translator note: 십시오 is very formal and better suited for official or enterprise contexts (e.g government websites), while 세요 feels approachable and appropriate for general users.
// Translator note: I have noted down improvement suggestions below based on my knowledge of modern Korean user interfaces without changing the original translations for your reference.

const ko = {
  name: "한국어",
  english_name: "Korean",
  code: "ko",
  dictionary: {
    about: "정보",
    account: "계정",
    account_password: "계정 비밀번호", // Added translation: "account password"
    access_granted_to: "접근 권한 부여",
    add_existing_account: "기존 계정 추가",
    all_fields_required: "모든 항목은 필수 입력사항입니다.",
    allow: "허용",
    apply: "적용",
    ascending: "오름차순",
    associated_websites: "관련 웹사이트",
    auto_arrange: "자동 정렬",
    background: "배경",
    browse: "찾아보기",
    cancel: "취소",
    center: "중앙",
    change_desktop_background: "바탕 화면 배경 변경…",
    change_email: "이메일 변경",
    change_language: "언어 변경",
    change_password: "비밀번호 변경",
    change_ui_colors: "UI 색상 변경",
    change_username: "사용자 이름 변경",
    close: "닫기",
    close_all_windows: "모든 창 닫기",
    close_all_windows_confirm: "정말 모든 창을 닫으시겠습니까?",
    close_all_windows_and_log_out: "창을 닫고 로그아웃",
    change_always_open_with: "이 형식의 파일을 항상 다음 앱으로 여시겠습니까?:",
    color: "색상",
    confirm: "확인",
    confirm_2fa_setup: "코드를 인증 앱에 추가했습니다",
    confirm_2fa_recovery: "복구 코드를 안전한 위치에 저장했습니다",
    confirm_account_for_free_referral_storage_c2a:
      "계정을 생성하고 이메일 주소를 확인하여 1GB의 무료 저장 공간을 받으십시오. 친구도 1GB의 무료 저장 공간을 받게 됩니다.", // Improvement suggestion: "계정을 만들고 이메일 주소를 확인하면 1GB의 무료 저장 공간을 드립니다! 친구와 공유하면 친구도 1GB를 받을 수 있습니다."
    confirm_code_generic_incorrect: "잘못된 코드입니다.",
    confirm_code_generic_too_many_requests:
      "요청이 너무 많습니다. 몇 분만 기다려주십시오.", // Improvement suggestion: "요청이 너무 많습니다. 잠시만 기다려주세요."
    confirm_code_generic_submit: "코드 제출",
    confirm_code_generic_try_again: "재시도",
    confirm_code_generic_title: "확인 코드를 입력하십시오", // Improvement suggestion: "인증 코드를 입력해주세요." (use 인증 if it's a verification/confirmation code)
    confirm_code_2fa_instruction: "인증 앱의 6자리 코드를 입력하십시오.", // Improvement suggestion: "인증 앱의 6자리 코드를 입력해주세요."
    confirm_code_2fa_submit_btn: "제출",
    confirm_code_2fa_title: "2FA 코드를 입력하십시오", // Improvement suggestion: "2FA 코드를 입력해주세요."
    confirm_delete_multiple_items:
      "정말로 이 항목들을 영구적으로 삭제하시겠습니까?", // Improvement suggestion: "항목들을 정말 영구적으로 삭제하시겠습니까?" (if it's a selection you could add "selected" to items like this: "선택된 항목들을 정말 영구적으로 삭제하시겠습니까?")
    confirm_delete_single_item: "이 항목을 영구적으로 삭제하시겠습니까?",
    confirm_open_apps_log_out:
      "열려있는 앱들이 있습니다. 정말로 로그아웃 하시겠습니까?",
    confirm_new_password: "새 비밀번호 확인",
    confirm_delete_user:
      "정말로 계정을 삭제하시겠습니까? 모든 파일과 데이터가 영구적으로 삭제됩니다. 이 작업은 취소될 수 없습니다.", // Improvement suggestion: "정말 계정을 삭제하시겠습니까? 모든 파일과 데이터가 영구적으로 삭제되며, 이 작업은 취소할 수 없습니다."
    confirm_delete_user_title: "계정 삭제?",
    confirm_session_revoke: "정말로 이 세션을 취소하시겠습니까?",
    confirm_your_email_address: "이메일 주소를 확인하십시오", // Improvement suggestion: "이메일 주소를 확인해주세요."
    contact_us: "문의하기",
    contact_us_verification_required: "인증된 이메일 주소가 있어야 합니다.", // Improvement suggestion: "이메일 인증이 필요합니다."
    contain: "포함",
    continue: "계속",
    copy: "복사",
    copy_link: "링크 복사",
    copying: "복사 중",
    copying_file: "%% 복사 중",
    cover: "표지",
    create_account: "계정 생성",
    create_free_account: "무료 계정 생성",
    create_shortcut: "바로 가기 만들기",
    credits: "크레딧",
    current_password: "현재 비밀번호",
    cut: "잘라내기",
    clock: "시계",
    clock_visible_hide: "숨기기 - 항상 숨김",
    clock_visible_show: "표시 - 항상 표시",
    clock_visible_auto: "자동 - 숨김",
    close_all: "전부 닫기",
    created: "만든 날짜",
    date_modified: "수정한 날짜",
    default: "기본값",
    delete: "삭제",
    delete_account: "계정 삭제",
    delete_permanently: "영구 삭제",
    deleting_file: "%% 삭제 중",
    deploy_as_app: "앱으로 배포",
    descending: "내림차순",
    desktop: "바탕화면",
    desktop_background_fit: "맞추기",
    developers: "개발자",
    dir_published_as_website: `%strong% 다음에 게시되었습니다:`,
    disable_2fa: "2FA 비활성화",
    disable_2fa_confirm: "정말로 2FA를 비활성화 하시겠습니까?",
    disable_2fa_instructions: "2FA 비활성화를 하려면 비밀번호를 입력하십시오.", // Improvement suggestion: "2FA 비활성화를 하려면 비밀번호를 입력해주세요."
    disassociate_dir: "디렉토리 연결 해제",
    documents: "문서",
    dont_allow: "허용하지 않음",
    download: "다운로드",
    download_file: "파일 다운로드",
    downloading: "다운로드 중",
    email: "이메일",
    email_change_confirmation_sent:
      "새 이메일 주소로 확인 메일이 전송되었습니다. 받은 편지함을 확인하시고 안내에 따라 절차를 완료하십시오.", // Improvement suggestion: "새 이메일 주소로 확인 메일이 전송되었습니다. 받은 편지함을 확인 후 안내에 따라 절차를 완료해주세요."
    email_invalid: "이메일이 유효하지 않습니다.",
    email_or_username: "이메일 또는 사용자 이름",
    email_required: "이메일은 필수 입력사항입니다.",
    empty_trash: "휴지통 비우기",
    empty_trash_confirmation: `휴지통의 항목을 영구적으로 삭제하시겠습니까?`,
    emptying_trash: "휴지통 비우는 중…",
    enable_2fa: "2FA 활성화",
    end_hard: "하드 종료",
    end_process_force_confirm: "정말로 이 프로세스를 강제 종료 하시겠습니까?",
    end_soft: "소프트 종료",
    enlarged_qr_code: "확대된 QR 코드",
    enter_password_to_confirm_delete_user:
      "계정 삭제를 승인하려면 비밀번호를 입력하십시오.", // Improvement suggestion: "계정 삭제를 승인하려면 비밀번호를 입력해주세요."
    error_message_is_missing: "오류 메세지를 찾을 수 없습니다.",
    error_unknown_cause: "알 수 없는 오류가 발생했습니다.",
    error_uploading_files: "파일들을 업로드 하는데 실패했습니다", // Improvement suggestion: "파일 업로드가 실패했습니다"
    favorites: "즐겨찾기",
    feedback: "피드백",
    feedback_c2a:
      "아래 양식을 사용하여 피드백, 의견 및 버그 보고를 보내십시오.", // Improvement suggestion: "아래 양식을 통해 피드백, 의견 또는 버그 보고를 보내주세요."
    feedback_sent_confirmation:
      "문의해 주셔서 감사합니다. 계정에 이메일이 연결되어 있으면 가능한 빨리 회신 드리겠습니다.", // Improvement suggestion: "문의해 주셔서 감사합니다. 계정에 이메일이 연결되어 있다면 최대한 빨리 답변드리겠습니다."
    fit: "맞춤",
    folder: "폴더",
    force_quit: "강제 종료",
    forgot_pass_c2a: "비밀번호를 잊으셨나요?",
    from: "보낸 사람",
    general: "일반",
    get_a_copy_of_on_puter: `Puter.com에서 '%%'의 사본을 받으세요!`,
    get_copy_link: "링크 복사",
    hide_all_windows: "모든 창 숨기기",
    home: "홈",
    html_document: "HTML 문서",
    hue: "색조",
    image: "이미지",
    incorrect_password: "잘못된 비밀번호",
    invite_link: "초대 링크",
    item: "개 항목",
    items_in_trash_cannot_be_renamed: `이 항목은 휴지통에 있기 때문에 이름을 바꿀 수 없습니다. 이 항목의 이름을 바꾸려면 먼저 휴지통에서 끌어내십시오.`, // Improvement suggestion: "이 항목은 휴지통에 있어 이름을 변경할 수 없습니다. 이름을 변경하려면 먼저 휴지통에서 복원해주세요."
    jpeg_image: "JPEG 이미지",
    keep_in_taskbar: "작업 표시줄에 유지",
    language: "언어",
    license: "라이선스",
    lightness: "밝기",
    link_copied: "링크 복사됨",
    loading: "로드 중",
    log_in: "로그인",
    log_into_another_account_anyway: "다른 계정으로 로그인",
    log_out: "로그아웃",
    looks_good: "좋아 보입니다!",
    manage_sessions: "세션 관리",
    menubar_style: "메뉴 표시줄 스타일",
    menubar_style_desktop: "바탕화면",
    menubar_style_system: "시스템",
    menubar_style_window: "윈도우",
    modified: "수정한 날짜",
    move: "이동",
    moving_file: "이동 중 %%",
    my_websites: "내 웹사이트",
    name: "이름",
    name_cannot_be_empty: "이름은 비워둘 수 없습니다.",
    name_cannot_contain_double_period: "이름은 '..' 문자일 수 없습니다.",
    name_cannot_contain_period: "이름은 '.' 문자일 수 없습니다.",
    name_cannot_contain_slash: "이름에 '/' 문자를 포함할 수 없습니다.",
    name_must_be_string: "이름은 문자열만 가능합니다.",
    name_too_long: `이름은 %%자보다 길 수 없습니다.`,
    new: "새로 만들기",
    new_email: "새 이메일",
    new_folder: "새 폴더",
    new_password: "새 비밀번호",
    new_username: "새 사용자 이름",
    no: "아니오",
    no_dir_associated_with_site: "이 주소에 연결된 디렉토리가 없습니다.",
    no_websites_published: "아직 웹사이트를 게시하지 않았습니다.",
    ok: "확인",
    open: "열기",
    open_in_new_tab: "새 탭에서 열기",
    open_in_new_window: "새 창에서 열기",
    open_with: "앱으로 열기",
    original_name: "원본 이름",
    original_path: "원본 경로",
    oss_code_and_content: "오픈 소스 소프트웨어 및 콘텐츠",
    password: "비밀번호",
    password_changed: "비밀번호가 변경되었습니다.",
    password_recovery_rate_limit:
      "속도 제한에 도달했습니다. 몇 분만 기다려 주십시오. 앞으로 이 문제를 방지하려면 페이지를 너무 많이 다시 로드하지 마십시오.", // Improvement suggestion: "속도 제한에 도달했습니다. 잠시만 기다려주세요. 앞으로 이런 문제가 발생하지 않도록 페이지를 자주 새로고침하지 마세요."
    password_recovery_token_invalid:
      "이 비밀번호 복구 토큰은 더 이상 유효하지 않습니다.", // Improvement suggestion: "유효하지 않은 비밀번호 복구 토큰입니다."
    password_recovery_unknown_error:
      "알 수 없는 오류가 발생했습니다. 나중에 다시 시도해주십시오.", // Improvement suggestion: "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    password_required: "비밀번호는 필수 입력사항 입니다.",
    password_strength_error:
      "비밀번호는 반드시 최소 8자 이상이어야 하며 최소 대문자 1개, 소문자 1개, 숫자 1개, 특수문자 1개를 포함해야 합니다.",
    passwords_do_not_match:
      "`새 비밀번호`와 `새 비밀번호 확인`이 일치하지 않습니다.",
    paste: "붙여넣기",
    paste_into_folder: "폴더에 붙여넣기",
    path: "경로",
    personalization: "개인 설정",
    pick_name_for_website: "웹사이트 이름을 선택하세요:",
    picture: "사진",
    pictures: "사진",
    plural_suffix: " ",
    powered_by_puter_js: `제공: {{link=docs}}Puter.js{{/link}}`,
    preparing: "준비 중...",
    preparing_for_upload: "업로드 준비 중...",
    print: "인쇄",
    privacy: "개인정보",
    proceed_to_login: "로그인 진행",
    proceed_with_account_deletion: "계정 삭제 진행",
    process_status_initializing: "초기화 중",
    process_status_running: "실행 중",
    process_type_app: "앱",
    process_type_init: "초기화",
    process_type_ui: "UI",
    properties: "속성",
    public: "공개",
    publish: "게시",
    publish_as_website: "웹사이트로 게시",
    puter_description: `Puter는 모든 파일, 앱, 게임을 하나의 안전한 공간에 보관하고 언제 어디서나 접속할 수 있으며 개인 정보 보호를 우선시하는 개인 클라우드입니다. `,
    reading_file: "%strong% 읽는 중",
    recent: "최근",
    recommended: "추천",
    recover_password: "비밀번호 찾기",
    refer_friends_c2a:
      "Puter에서 계정을 생성하고 확인한 친구마다 1GB를 받으십시오. 친구도 1GB를 받게 됩니다!", // Improvement suggestion: "Puter에서 계정을 만들고 확인한 친구마다 1GB를 받아보세요. 친구도 1GB를 받게 됩니다!"
    refer_friends_social_media_c2a: `Puter.com에서 1GB의 무료 저장 공간을 받으십시오!`, // Improvement suggestion: "Puter.com에서 1GB의 무료 저장 공간을 받아보세요!"
    refresh: "새로 고침",
    release_address_confirmation: `이 주소를 해제하시겠습니까?`,
    remove_from_taskbar: "작업 표시줄에서 제거",
    rename: "이름 변경",
    repeat: "반복",
    replace: "교체",
    replace_all: "모두 교체",
    resend_confirmation_code: "확인 코드 다시 보내기", // Improvement suggestion: "인증 코드 재전송"
    reset_colors: "색상 초기화",
    restart_puter_confirm: "정말 Puter를 다시 시작하시겠습니까?",
    restore: "복원",
    save: "저장",
    saturation: "채도",
    save_account: "계정 저장",
    save_account_to_get_copy_link: "계속하려면 계정을 생성하십시오.", // Improvement suggestion: "계속하려면 계정을 만들어주세요."
    save_account_to_publish: "계속하려면 계정을 생성하십시오.", // Improvement suggestion: "계속하려면 계정을 만들어주세요."
    save_session: "세션 저장",
    save_session_c2a:
      "현재 세션을 저장하고 작업을 잃지 않으려면 계정을 생성하십시오.", // Improvement suggestion: "현재 세션을 저장하고 작업을 잃지 않으려면 계정을 만들어주세요."
    scan_qr_c2a:
      "다른 기기에서 이 세션으로 로그인하려면 아래 코드를 스캔하십시오", // Improvement suggestion: change 스캔하십시오 to 스캔해주세요 for the next 3 lines.
    scan_qr_2fa: "인증 앱으로 QR 코드를 스캔하십시오.",
    scan_qr_generic: "휴대전화나 다른 기기로 QR 코드를 스캔하십시오",
    search: "검색",
    seconds: "초",
    security: "보안",
    select: "선택",
    selected: "선택됨",
    select_color: "색상 선택…",
    sessions: "세션",
    send: "보내기",
    send_password_recovery_email: "비밀번호 복구 이메일 보내기",
    session_saved: "계정을 생성해 주셔서 감사합니다. 이 세션이 저장되었습니다.", // Improvement suggestion: "계정을 만들어주셔서 감사합니다. 현재 세션이 저장되었습니다."
    settings: "설정",
    set_new_password: "새 비밀번호 설정",
    share: "공유",
    share_to: "공유처",
    share_with: "공유 대상",
    shortcut_to: "바로 가기",
    show_all_windows: "모든 창 표시",
    show_hidden: "숨김 항목 표시",
    sign_in_with_puter: "Puter로 로그인",
    sign_up: "가입",
    signing_in: "로그인 중…",
    size: "크기",
    skip: "건너뛰기",
    something_went_wrong: "무언가 잘못되었습니다.", // Improvement suggestion: "문제가 발생했습니다" ("There was a problem") which is more widely used for errors.
    sort_by: "정렬 기준",
    start: "시작",
    status: "상태",
    storage_usage: "저장 공간 사용량",
    storage_puter_used: "Puter에서 사용 중",
    taking_longer_than_usual:
      "보통보다 조금 더 오래 걸립니다. 잠시만 기다려 주십시오...", // Improvement suggestion: "평소보다 조금 더 오래 걸리고 있습니다. 잠시만 기다려주세요..."

    task_manager: "작업 관리자",
    taskmgr_header_name: "이름",
    taskmgr_header_status: "상태",
    taskmgr_header_type: "유형",
    terms: "약관",
    text_document: "텍스트 문서",
    tos_fineprint: `무료 계정 생성을 클릭하면 Puter의 {{link=terms}}서비스 약관{{/link}}과 {{link=privacy}}개인정보 보호정책{{/link}}에 동의하는 것입니다.`,
    transparency: "투명도",
    trash: "휴지통",
    two_factor: "2단계 인증(2FA)",
    two_factor_disabled: "2FA 비활성화됨",
    two_factor_enabled: "2FA 활성화됨",
    type: "유형",
    type_confirm_to_delete_account:
      "계정을 삭제하려면 'confirm'을 입력하십시오.", // Improvement suggestion: "계정을 삭제하려면 'confirm'을 입력해주세요."
    ui_colors: "UI 색상",
    ui_manage_sessions: "세션 관리자",
    ui_revoke: "취소",
    undo: "실행 취소",
    unlimited: "무제한",
    unzip: "압축 해제",
    upload: "업로드",
    upload_here: "여기에 업로드",
    usage: "사용량",
    username: "사용자 이름",
    username_changed: "사용자 이름이 성공적으로 업데이트되었습니다.", // Improvement suggestion: "사용자 이름이 변경되었습니다." (simplified)
    username_required: "사용자 이름은 필수 입력사항입니다.",
    versions: "버전",
    videos: "동영상",
    visibility: "가시성", // This depends on the specific context - if it means that content is visible/public or hidden/private, I would suggest changing it to "공개 여부" if the user can choose Yes/No or simply 공개 for visible/public) and 비공개 for invisible/private.
    yes: "예",
    yes_release_it: "예, 해제합니다",
    you_have_been_referred_to_puter_by_a_friend: "친구가 Puter로 추천했습니다!", // Improvement suggestion: "친구가 Puter를 추천했습니다!"
    zip: "압축",
    zipping_file: "%strong% 압축 중",

    // === 2FA Setup ===
    setup2fa_1_step_heading: "인증 앱을 여십시오", // Improvement suggestion: "인증 앱을 열어주세요."
    setup2fa_1_instructions: `
        시간 기반 일회용 비밀번호(TOTP) 프로토콜을 지원하는 모든 인증 앱을 사용할 수 있습니다.
        선택할 수 있는 앱은 많지만, 잘 모르겠다면 안드로이드 및 iOS용
        <a target="_blank" href="https://authy.com/download">Authy</a>
        가 무난한 선택입니다.
    `,
    setup2fa_2_step_heading: "QR 코드를 스캔하십시오", // Improvement suggestion: "QR 코드를 스캔해주세요"
    setup2fa_3_step_heading: "6자리 코드를 입력하십시오", // Improvement suggestion: "6자리 코드를 입력해주세요"
    setup2fa_4_step_heading: "복구 코드를 복사하십시오", // Improvement suggestion: "복구 코드를 복사해주세요"
    setup2fa_4_instructions: `
        이 복구코드들은 휴대전화를 잃어버리거나 인증 앱을 사용할 수 없을 때 계정에 접속할 수 있는 유일한 수단입니다.
        반드시 안전한 장소에 보관하세요.
    `, // Improvement suggestion: "복구 코드는 휴대전화를 분실하거나 인증 앱을 사용할 수 없을 때 계정에 접속할 수 있는 유일한 방법입니다. 반드시 안전한 장소에 보관하세요."
    setup2fa_5_step_heading: "2FA 설정 확인",
    setup2fa_5_confirmation_1: "복구 코드를 안전한 위치에 저장했습니다",
    setup2fa_5_confirmation_2: "2FA를 활성화할 준비가 되었습니다",
    setup2fa_5_button: "2FA 활성화",

    // === 2FA Login ===
    login2fa_otp_title: "2FA 코드를 입력하십시오", // Improvement suggestion: "2FA 코드를 입력해주세요"
    login2fa_otp_instructions: "인증 앱의 6자리 코드를 입력하십시오.", // Improvement suggestion: "인증 앱의 6자리 코드를 입력해주세요."
    login2fa_recovery_title: "복구코드를 입력하십시오", // Improvement suggestion: "복구코드를 입력해주세요"
    login2fa_recovery_instructions:
      "계정 접속을 위해 복구코드들 중 하나를 입력하십시오.", // Improvement suggestion: "계정에 접속하려면 복구코드 중 하나를 입력해주세요."
    login2fa_use_recovery_code: "복구코드 사용",
    login2fa_recovery_back: "뒤로 가기", // Improvement suggestion: "뒤로"
    login2fa_recovery_placeholder: "XXXXXXXX",

    account_password: "계정 비밀번호 인증",
    change: "변경",
    clock_visibility: "시계 표시 설정",
    reading: `%strong% 읽는 중`,
    writing: `%strong% 기록 중`,
    unzipping: `%strong% 압축 해제 중`,
    sequencing: `%strong% 순서 처리 중`,
    zipping: `%strong% 압축 중`,
    Editor: "편집자", // If it refers to a person, the correct translation is "편집자" ,If it refers to the tool or software, the translation would be "편집기"
    Viewer: "조회자", // If it refers to a person, the correct translation is "조회자" ,If it refers to the tool or software, the translation would be "뷰어"
    "People with access": "권한 보유자",
    "Share With…": "공유 대상...",
    Owner: "소유자",
    "You can't share with yourself.": "자기 자신과는 공유할 수 없습니다.",
    "This user already has access to this item":
      "이 사용자는 이미 접근 권한이 있습니다.",

    "billing.change_payment_method": "결제 수단 변경", // added "payment method"
    "billing.cancel": "취소",
    "billing.download_invoice": "청구서 다운로드", // added "invoice"
    "billing.payment_method": "결제 수단", // changed 방법 to 수단 which is more widely used in payment UIs
    "billing.payment_method_updated": "결제 수단이 변경되었습니다!", // changed to more natural Korean
    "billing.confirm_payment_method": "결제 수단 확인", // In English: "Confirm Payment Method"
    "billing.payment_history": "결제 내역", // In English: "Payment History"
    "billing.refunded": "환불 완료", // In English: "Refunded"
    "billing.paid": "결제 완료", // In English: "Paid"
    "billing.ok": "확인", // In English: "OK"
    "billing.resume_subscription": "구독 재개", // In English: "Resume Subscription"
    "billing.subscription_cancelled": "구독이 취소되었습니다.", // In English: "Your subscription has been canceled."
    "billing.subscription_cancelled_description":
      "청구 기간이 끝날 때까지 구독을 계속 이용할 수 있습니다.", // In English: "You will still have access to your subscription until the end of this billing period."
    "billing.offering.free": "무료", // In English: "Free"
    "billing.offering.pro": "프로", // In English: "Professional"
    "billing.offering.business": "비즈니스", // In English: "Business"
    "billing.cloud_storage": "클라우드 저장소", // In English: "Cloud Storage"
    "billing.ai_access": "AI 접근", // In English: "AI Access"
    "billing.bandwidth": "대역폭", // In English: "Bandwidth"
    "billing.apps_and_games": "앱 및 게임", // In English: "Apps & Games"
    "billing.upgrade_to_pro": "%strong%으로 업그레이드", // In English: "Upgrade to %strong%" ; Important Translation note: 으 is omitted when it placed after a vowel, meaning: when putting free, pro and business in front of 으로 you need to change it to 로 only (example: "무료로" "프로로" "비즈니스로")
    "billing.switch_to": "%strong%으로 변경", // In English: "Switch to %strong%", Translation note: same logic from above regarding 으로 applies here too
    "billing.payment_setup": "결제 설정", // In English: "Payment Setup"
    "billing.back": "뒤로", // In English: "Back"
    "billing.you_are_now_subscribed_to":
      "%strong% 플랜으로 구독이 완료되었습니다.", // In English: "You are now subscribed to %strong% tier."
    "billing.you_are_now_subscribed_to_without_tier": "구독이 완료되었습니다", // In English: "You are now subscribed"
    "billing.subscription_cancellation_confirmation":
      "정말 구독을 취소하시겠습니까?", // In English: "Are you sure you want to cancel your subscription?"
    "billing.subscription_setup": "구독 설정", // In English: "Subscription Setup"
    "billing.cancel_it": "취소하기", // In English: "Cancel It"
    "billing.keep_it": "유지하기", // In English: "Keep It"
    "billing.subscription_resumed": "귀하의 %strong% 구독이 재개되었습니다!", // In English: "Your %strong% subscription has been resumed!"
    "billing.upgrade_now": "지금 업그레이드", // In English: "Upgrade Now"
    "billing.upgrade": "업그레이드", // In English: "Upgrade"
    "billing.currently_on_free_plan": "현재 무료 플랜을 이용 중입니다.", // In English: "You are currently on the free plan."
    "billing.download_receipt": "영수증 다운로드", // In English: "Download Receipt"
    "billing.subscription_check_error":
      "구독 상태를 확인하는 중 문제가 발생했습니다.", // In English: "A problem occurred while checking your subscription status."
    "billing.email_confirmation_needed":
      "이메일이 인증되지 않았습니다. 인증 코드를 보내드리겠습니다.", // In English: "Your email has not been confirmed. We'll send you a code to confirm it now."
    "billing.sub_cancelled_but_valid_until":
      "구독이 취소되었으며, 청구 기간이 끝나면 자동으로 무료 플랜으로 전환됩니다. 구독을 다시 설정할 경우에만 비용이 부과됩니다.", // In English: "You have cancelled your subscription and it will automatically switch to the free tier at the end of the billing period. You will not be charged again unless you re-subscribe."
    "billing.current_plan_until_end_of_period":
      "청구 기간이 끝날 때까지 유지되는 현재 플랜입니다.", // In English: "Your current plan until the end of this billing period."
    "billing.current_plan": "현재 플랜", // In English: "Current plan" ; depending on the context you could use: "구독 중인 플랜" (plan you are subscribed to)
    "billing.cancelled_subscription_tier": "취소된 구독 (%%)", // In English: "Cancelled Subscription (%%)"
    "billing.manage": "관리", // In English: "Manage"
    "billing.limited": "제한됨", // In English: "Limited"
    "billing.expanded": "확장됨", // In English: "Expanded"
    "billing.accelerated": "가속됨", // In English: "Accelerated"
    "billing.enjoy_msg": "클라우드 저장소 %% 등 다양한 혜택을 즐겨보세요", // In English: "Enjoy %% of Cloud Storage plus other benefits."
  },
};

export default ko;
