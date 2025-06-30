/**
 * Copyright (C) 2024-present Puter Technologies Inc.
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

/**
 * Traslation notes:
 *  - Change all "Email" to "Correo electrónico"
 *  - puter_description the most acurated translation for "privacy-first personal cloud" I could think of is "servicio de nube personal enfocado en privacidad"
 *  - plural_suffix: 's' has no direct translation to spanish. There are multiple plural suffix in spanish 'as' || "es" || "os || "s". Leave "s" as it is only been used on item: 'elemento' and will end up as 'elementos'
 */

const es = {
  name: 'Español',
  english_name: 'Spanish',
  code: 'es',
  dictionary: {
    about: 'Acerca De',
    account: 'Cuenta',
    account_password: 'Verifica Contraseña De La Cuenta',
    access_granted_to: 'Acceso Permitido A',
    add_existing_account: 'Añadir una cuenta existente',
    all_fields_required: 'Todos los campos son obligatorios.',
    allow: 'Permitir',
    apply: 'Aplicar',
    ascending: 'Ascendiente',
    associated_websites: 'Sitios Web Asociados',
    auto_arrange: 'Organización Automática',
    background: 'Fondo',
    browse: 'Buscar',
    cancel: 'Cancelar',
    center: 'Centrar',
    change_desktop_background: 'Cambiar el fondo de pantalla…',
    change_email: 'Cambiar Correo Electrónico',
    change_language: 'Cambiar Idioma',
    change_password: 'Cambiar Contraseña',
    change_ui_colors: 'Cambiar colores de la interfaz',
    change_username: 'Cambiar Nombre de Usuario',
    close: 'Cerrar',
    close_all_windows: 'Cerrar todas las ventanas',
    close_all_windows_confirm:
      '¿Estás seguro de que quieres cerrar todas las ventanas?',
    close_all_windows_and_log_out: 'Cerrar ventanas y cerrar sesión',
    change_always_open_with: '¿Quieres abrir siempre este tipo de archivos con',
    color: 'Color',
    confirm: 'Confirmar',
    confirm_2fa_setup: 'He añadido el código a mi aplicación de autenticación',
    confirm_2fa_recovery:
      'He guardado mis códigos de recuperación en un lugar seguro',
    confirm_account_for_free_referral_storage_c2a:
      'Crea una cuenta y confirma tu correo electrónico para recibir 1 GB de almacenamiento gratuito. Tu amigo recibirá 1 GB de almacenamiento gratuito también.',
    confirm_code_generic_incorrect: 'Código incorrecto.',
    confirm_code_generic_too_many_requests:
      'Too many requests. Please wait a few minutes.',
    confirm_code_generic_submit: 'Enviar código',
    confirm_code_generic_try_again: 'Intenta nuevamente',
    confirm_code_generic_title: 'Enter Confirmation Code',
    confirm_code_2fa_instruction:
      'Ingresa los 6 dígitos de tu aplicación de autenticación.',
    confirm_code_2fa_submit_btn: 'Enviar',
    confirm_code_2fa_title: 'Ingrese el código de 2FA',
    confirm_delete_multiple_items:
      '¿Estás seguro de que quieres eliminar permanentemente estos elementos?',
    confirm_delete_single_item:
      '¿Quieres eliminar este elemento permanentemente?',
    confirm_open_apps_log_out:
      'Tienes aplicaciones abiertas.¿Estás seguro de que quieres cerrar sesión?',
    confirm_new_password: 'Confirma la Nueva Contraseña',
    confirm_delete_user:
      '¿Estás seguro que quieres borrar esta cuenta? Todos tus archivos e información serán borrados permanentemente. Esta acción no se puede deshacer.',
    confirm_delete_user_title: '¿Eliminar cuenta?',
    confirm_session_revoke: '¿Estás seguro de que quieres revocar esta sesión?',
    confirm_your_email_address: 'Confirma tu dirección de correo electrónico',
    contact_us: 'Contáctanos',
    contact_us_verification_required:
      'Debes tener un correo electrónico verificado para usar esto.',
    contain: 'Contiene',
    continue: 'Continuar',
    copy: 'Copiar',
    copy_link: 'Copiar Enlace',
    copying: 'Copiando',
    copying_file: 'Copiando %%',
    cover: 'Cubrir',
    create_account: 'Crear una cuenta',
    create_free_account: 'Crear una cuenta gratuita',
    create_shortcut: 'Crear un acceso directo',
    credits: 'Creditos',
    current_password: 'Contraseña actual',
    cut: 'Cortar',
    clock: 'Reloj',
    clock_visible_hide: 'Ocultar - Siempre oculto',
    clock_visible_show: 'Mostrar - Siempre visible',
    clock_visible_auto:
      'Auto - Por defecto, visible solo en modo pantalla completa.',
    close_all: 'Cerrar todo',
    created: 'Creado',
    date_modified: 'Fecha de modificación',
    default: 'Por defecto',
    delete: 'Borrar',
    delete_account: 'Borrar cuenta',
    delete_permanently: 'Borrar permanentemente',
    deleting_file: 'Eliminando %%',
    deploy_as_app: 'Desplegar como una aplicación',
    descending: 'Descendiente',
    desktop: 'Escritorio',
    desktop_background_fit: 'Ajustar',
    developers: 'Desarrolladores',
    dir_published_as_website: `%strong% ha sido publicado en:`,
    disable_2fa: 'Deshabilitar 2FA',
    disable_2fa_confirm: '¿Estás seguro que quieres deshabilitar 2FA?',
    disable_2fa_instructions: 'Ingresa tu contraseña para deshabilitar 2FA.',
    disassociate_dir: 'Desvincular directorio',
    documents: 'Documentos',
    dont_allow: 'No permitir',
    download: 'Descargar',
    download_file: 'Descargar archivo',
    downloading: 'Descargando',
    email: 'Correo electrónico',
    email_change_confirmation_sent:
      'Se ha enviado un mensaje de confirmación a tu nueva dirección de correo electrónico. Por favor, revisa tu bandeja de entrada y sigue las instrucciónes para completar el proceso.',
    email_invalid: 'El correo electrónico no es válido.',
    email_or_username: 'Correo electrónico o Nombre de Usuario',
    email_required: 'El correo electrónico es obligatorio.',
    empty_trash: 'Vaciar la papelera',
    empty_trash_confirmation: `¿Estás seguro de que quieres borrar permanentemente todos los elementos de la Papelera?`,
    emptying_trash: 'Vaciando la papelera…',
    enable_2fa: 'Habilitar 2FA',
    end_hard: 'Finalizar abruptamente',
    end_process_force_confirm:
      '¿Estás seguro de que quieres forzar la salida de este proceso?',
    end_soft: 'Finalizar suavemente',
    enlarged_qr_code: 'Código QR ampliado',
    enter_password_to_confirm_delete_user:
      'Ingresa tu contraseña para confirmar la eliminación de la cuenta',
    error_message_is_missing: 'Falta el mensaje de error.',
    error_unknown_cause: 'Un error desconocido a ocurrido.',
    error_uploading_files: 'Error al subir archivos',
    favorites: 'Favoritos',
    feedback: 'Sugerencias',
    feedback_c2a:
      'Por favor, usa el formulario para enviarnos tus sugerencias, comentarios y reporte de errores.',
    feedback_sent_confirmation:
      'Gracias por ponerte en contacto con nosotros. Si tienes un correo electrónico vinculado a esta cuenta, nos pondremos en contacto contigo tan pronto como podamos.',
    fit: 'Ajustar',
    folder: 'Carpeta',
    force_quit: 'Forzar cierre',
    forgot_pass_c2a: '¿Olvidaste tu contraseña?',
    from: 'De',
    general: 'General',
    get_a_copy_of_on_puter: `¡Consigue una copia de '%%' en Puter.com!`,
    get_copy_link: 'Copiar el enlace',
    hide_all_windows: 'Ocultar todas las ventanas',
    home: 'Inicio',
    html_document: 'Documento HTML',
    hue: 'Hue',
    image: 'Imagen',
    incorrect_password: 'Contraseña incorrecta',
    invite_link: 'Enlace de invitación',
    item: 'elemento',
    items_in_trash_cannot_be_renamed: `Este elemento no se puede renombrar porque está en la papelera. Para cambiar el nombre de este archivo, primero extráelo fuera de la misma.`,
    jpeg_image: 'Imagen JPEG',
    keep_in_taskbar: 'Mantener en la barra de tareas',
    language: 'Lenguage',
    license: 'Licencia',
    lightness: 'Claridad',
    link_copied: 'Enlace copiado',
    loading: 'Cargando',
    log_in: 'Iniciar sesión',
    log_into_another_account_anyway:
      'Iniciar sesión en otra cuenta de todos modos',
    log_out: 'Cerrar sesión',
    looks_good: 'Se ve bien!',
    manage_sessions: 'Administrar sesión',
    modified: 'Modified',
    move: 'Mover',
    moving_file: 'Moviendo %%',
    my_websites: 'Mis páginas web',
    name: 'Nombre',
    name_cannot_be_empty: 'El nombre no puede estar vacío.',
    name_cannot_contain_double_period:
      "El nombre no puede ser el carácter '..'.",
    name_cannot_contain_period: "El nombre no puede ser el carácter '.'.",
    name_cannot_contain_slash: "El nombre no puede contener el carácter '/'.",
    name_must_be_string: 'El nombre debe ser una cadena de texto.',
    name_too_long: `El nombre no puede tener más de %% caracteres.`,
    new: 'Nuevo',
    new_email: 'Nuevo correo electrónico',
    new_folder: 'Nueva carpeta',
    new_password: 'Nueva contraseña',
    new_username: 'Nuevo nombre de usuario',
    no: 'No',
    no_dir_associated_with_site:
      'No hay un directorio vinculado con esta dirección.',
    no_websites_published:
      'Aun no has publicado ningún sitio web. Haz click derecho en una carpeta para empezar',
    ok: 'OK',
    open: 'Abrir',
    open_in_new_tab: 'Abrir en una nueva pestaña',
    open_in_new_window: 'Abrir en una nueva ventana',
    open_with: 'Abrir con',
    original_name: 'Nombre original',
    original_path: 'Ruta original',
    oss_code_and_content: 'Software y contenido de código abierto',
    password: 'Contraseña',
    password_changed: 'Contraseña cambiada.',
    password_recovery_rate_limit:
      'Haz alcanzado nuestra tasa de refresco; por favor espera unos minutos. Para evitar esto en el futuro, evita refrescar la página muchas veces.',
    password_recovery_token_invalid:
      'La contraseña de token de recuperación ya no es válida.',
    password_recovery_unknown_error:
      'Ocurrió un error desconocido. Por favor, inténtalo de nuevo más tarde.',
    password_required: 'La contraseña es obligatoria.',
    password_strength_error:
      'La contraseña debe tener almenos 8 caracteres de largo y contener almenos una letra mayúscula, una minúscula, un numero, y un caracter especial.',
    passwords_do_not_match:
      '`Nueva Contraseña` y `Confirmar Nueva Contraseña` no coinciden.',
    paste: 'Pegar',
    paste_into_folder: 'Pegar en la Carpeta',
    path: 'Ruta',
    personalization: 'Personalización',
    pick_name_for_website: 'Escoge un nombre para tu página web:',
    picture: 'Imagen',
    pictures: 'Imagenes',
    plural_suffix: 's',
    powered_by_puter_js: `Creado por {{link=docs}}Puter.js{{/link}}`,
    preparing: 'Preparando...',
    preparing_for_upload: 'Preparando para la subida...',
    print: 'Imprimir',
    privacy: 'Privacidad',
    proceed_to_login: 'Procede a iniciar sesión',
    proceed_with_account_deletion: 'Procede con la eliminación de la cuenta',
    process_status_initializing: 'Inicializando',
    process_status_running: 'El ejecución',
    process_type_app: 'Aplicación',
    process_type_init: 'Inicialización',
    process_type_ui: 'Interfaz de usuario',
    properties: 'Propiedades',
    public: 'Publico',
    publish: 'Publicar',
    publish_as_website: 'Publicar como página web',
    puter_description: `Puter es un servicio de nube personal enfocado en privacidad que mantiene tus archivos, aplicaciónes, y juegos en un solo lugar, accesible desde cualquier lugar en cualquier momento.`,
    reading_file: 'Leyendo %strong%',
    recent: 'Reciente',
    recommended: 'Recomendado',
    recover_password: 'Recuperar Contraseña',
    refer_friends_c2a:
      'Consigue 1 GB por cada amigo que cree y confirme una cuenta en Puter ¡Tu amigo recibirá 1GB también!',
    refer_friends_social_media_c2a: `¡Consigue 1 GB de almacenamiento gratuito en Puter.com!`,
    refresh: 'Refrescar',
    release_address_confirmation: `¿Estás seguro de que quieres liberar esta dirección?`,
    remove_from_taskbar: 'Eliminar de la barra de tareas',
    rename: 'Renombrar',
    repeat: 'Repetir',
    replace: 'Remplazar',
    replace_all: 'Replace All',
    resend_confirmation_code: 'Reenviar Código de Confirmación',
    reset_colors: 'Restablecer colores',
    restart_puter_confirm: '¿Estás seguro que deseas reiniciar Puter?',
    restore: 'Restaurar',
    save: 'Guardar',
    saturation: 'Saturación',
    save_account: 'Guardar cuenta',
    save_account_to_get_copy_link: 'Por favor, crea una cuenta para continuar.',
    save_account_to_publish: 'Por favor, crea una cuenta para continuar.',
    save_session: 'Guardar sesión',
    save_session_c2a:
      'Crea una cuenta para guardar tu sesión actual y evitar así perder tu trabajo.',
    scan_qr_c2a:
      'Escanee el código a continuación para inicia sesión desde otros dispositivos',
    scan_qr_2fa: 'Escanee el codigo QR con su aplicación de autenticación',
    scan_qr_generic: 'Scan this QR code using your phone or another device',
    search: 'Buscar',
    seconds: 'segundos',
    security: 'Seguridad',
    select: 'Seleccionar',
    selected: 'seleccionado',
    select_color: 'Seleccionar color…',
    sessions: 'Sesión',
    send: 'Enviar',
    send_password_recovery_email:
      'Enviar la contraseña al correo de recuperación',
    session_saved: 'Gracias por crear una cuenta. La sesión ha sido guardada.',
    set_new_password: 'Establecer una nueva contraseña',
    settings: 'Opciones',
    share: 'Compartir',
    share_to: 'Compartir a',
    share_with: 'Compartir con:',
    shortcut_to: 'Acceso directo a',
    show_all_windows: 'Mostrar todas las ventanas',
    show_hidden: 'Mostrar ocultos',
    sign_in_with_puter: 'Inicia sesión con Puter',
    sign_up: 'Registrarse',
    signing_in: 'Registrándose…',
    size: 'Tamaño',
    skip: 'Saltar',
    something_went_wrong: 'Algo salió mal.',
    sort_by: 'Ordenar Por',
    start: 'Inicio',
    status: 'Estado',
    storage_usage: 'Uso del almacenamiento',
    storage_puter_used: 'Usado por Puter',
    taking_longer_than_usual:
      'Tardando un poco más de lo habitual. Por favor, espere...',
    task_manager: 'Administrador de tareas',
    taskmgr_header_name: 'Nombre',
    taskmgr_header_status: 'Estado',
    taskmgr_header_type: 'Tipo',
    terms: 'Terminos',
    text_document: 'Documento de Texto',
    tos_fineprint: `Al hacer clic en 'Crear una cuenta gratuita' aceptas los {{link=terms}}términos del servicio{{/link}} y {{link=privacy}}la política de privacidad{{/link}} de Puter.`,
    transparency: 'Transparencia',
    trash: 'Papelera',
    two_factor: 'Autenticación de dos factores',
    two_factor_disabled: '2FA Deshabilitadp',
    two_factor_enabled: '2FA Habilitado',
    type: 'Tipo',
    type_confirm_to_delete_account:
      "Ingrese 'Confirmar' para borrar esta cuenta.",
    ui_colors: 'Colores de interfaz',
    ui_manage_sessions: 'Administrador de sesión',
    ui_revoke: 'Revocar',
    undo: 'Deshacer',
    unlimited: 'Ilimitado',
    unzip: 'Descomprimir',
    upload: 'Subir',
    upload_here: 'Subir aquí',
    usage: 'Uso',
    username: 'Nombre de usuario',
    username_changed: 'Nombre de usuario actualizado correctamente.',
    username_required: 'El nombre de usuario es obligatorio.',
    versions: 'Versiones',
    videos: 'Videos',
    visibility: 'Visibilidad',
    yes: 'Si',
    yes_release_it: 'Sí, libéralo',
    you_have_been_referred_to_puter_by_a_friend:
      '¡Has sido invitado a Puter por un amigo!',
    zip: 'Zip',
    zipping_file: 'Compriminendo %strong%',

    // === 2FA Setup ===
    setup2fa_1_step_heading: 'Abre tu aplicación de autenticación',
    setup2fa_1_instructions: `
            Puedes usar cualquier aplicación de autenticación que soporte el protocolo de Time-based One-time (TOTP).
            Hay muchos para elegir, pero si no estas seguro
            <a target="_blank" href="https://authy.com/download">Authy</a>
            es una opción segura para Android y iOS.
        `,
    setup2fa_2_step_heading: 'Escanea el código QR',
    setup2fa_3_step_heading: 'Ingresa el código de 6 dígitos',
    setup2fa_4_step_heading: 'Copiar tus códigos de recuperación',
    setup2fa_4_instructions: `
            Estos códigos de recuperación son la única forma de acceder a tu cuenta, si pierdes tu teléfono o no puedes usar la aplicación de autenticación.
            Asegurate de guardarlos en un lugar seguro.
        `,
    setup2fa_5_step_heading: 'Confirmar la configuración de 2FA',
    setup2fa_5_confirmation_1:
      'He guardado mis códigos de recuperación en un lugar seguro',
    setup2fa_5_confirmation_2: 'Estoy listo para habilitar 2FA',
    setup2fa_5_button: 'Habilitar 2FA',

    // === 2FA Login ===
    login2fa_otp_title: 'Ingresar el código 2FA',
    login2fa_otp_instructions:
      'Ingresa tu código de 6 dígitos de tu aplicación de autenticación.',
    login2fa_recovery_title: 'Ingresa tu código de recuperación',
    login2fa_recovery_instructions:
      'Ingresa uno de tus códigos de recuperación para acceder a tu cuenta.',
    login2fa_use_recovery_code: 'Usar un código de recuperación',
    login2fa_recovery_back: 'Atras',
    login2fa_recovery_placeholder: 'XXXXXXXX',

    change: 'cambiar', // In English: "Change"
    clock_visibility: 'visibilidadReloj', // In English: "Clock Visibility"
    reading: 'lectura %strong%', // In English: "Reading %strong%"
    writing: 'escribiendo %strong%', // In English: "Writing %strong%"
    unzipping: 'descomprimiendo %strong%', // In English: "Unzipping %strong%"
    sequencing: 'secuenciación %strong%', // In English: "Sequencing %strong%"
    zipping: 'comprimiendo %strong%', // In English: "Zipping %strong%"
    Editor: 'Editor', // In English: "Editor"
    Viewer: 'Espectador', // In English: "Viewer"
    'People with access': 'Personas con acceso', // In English: "People with access"
    'Share With…': 'Compartir con…', // In English: "Share With…"
    Owner: 'Propietario', // In English: "Owner"
    "You can't share with yourself.": 'No puedes compartir contigo mismo.', // In English: "You can't share with yourself."
    'This user already has access to this item':
      'Este usuario ya tiene acceso a este elemento.', // In English: "This user already has access to this item"

    // === Billing ===

    'billing.change_payment_method': 'Cambiar método de pago', // In English: "Change Payment Method"
    'billing.cancel': 'Cancelar', // In English: "Cancel"
    'billing.download_invoice': 'Descargar factura', // In English: "Download Invoice"
    'billing.payment_method': 'Método de pago', // In English: "Payment Method"
    'billing.payment_method_updated': '¡Método de pago actualizado!', // In English: "Payment method updated!"
    'billing.confirm_payment_method': 'Confirmar método de pago', // In English: "Confirm Payment Method"
    'billing.payment_history': 'Historial de pagos', // In English: "Payment History"
    'billing.refunded': 'Reembolsado', // In English: "Refunded"
    'billing.paid': 'Pagado', // In English: "Paid"
    'billing.ok': 'Aceptar', // In English: "OK"
    'billing.resume_subscription': 'Reanudar suscripción', // In English: "Resume Subscription"
    'billing.subscription_cancelled': 'Tu suscripción ha sido cancelada.', // In English: "Your subscription has been canceled."
    'billing.subscription_cancelled_description':
      'Aún tendrás acceso a tu suscripción hasta el final de este periodo de facturación.', // In English: "You will still have access to your subscription until the end of this billing period."
    'billing.offering.free': 'Gratis', // In English: "Free"
    'billing.offering.pro': 'Profesional', // In English: "Professional"
    'billing.offering.professional': 'Profesional', // In English: "Professional"
    'billing.offering.business': 'Negocios', // In English: "Business"
    'billing.cloud_storage': 'Almacenamiento en la nube', // In English: "Cloud Storage"
    'billing.ai_access': 'Acceso a IA', // In English: "AI Access"
    'billing.bandwidth': 'Ancho de banda', // In English: "Bandwidth"
    'billing.apps_and_games': 'Aplicaciones y juegos', // In English: "Apps & Games"
    'billing.upgrade_to_pro': 'Actualizar a %strong%', // In English: "Upgrade to %strong%"
    'billing.switch_to': 'Cambiar a %strong%', // In English: "Switch to %strong%"
    'billing.payment_setup': 'Configuración de pago', // In English: "Payment Setup"
    'billing.back': 'Atrás', // In English: "Back"
    'billing.you_are_now_subscribed_to':
      'Ahora estás suscrito al nivel %strong%.', // In English: "You are now subscribed to %strong% tier."
    'billing.you_are_now_subscribed_to_without_tier': 'Ahora estás suscrito', // In English: "You are now subscribed"
    'billing.subscription_cancellation_confirmation':
      '¿Estás seguro de que deseas cancelar tu suscripción?', // In English: "Are you sure you want to cancel your subscription?"
    'billing.subscription_setup': 'Configuración de suscripción', // In English: "Subscription Setup"
    'billing.cancel_it': 'Cancelar', // In English: "Cancel It"
    'billing.keep_it': 'Mantenerlo', // In English: "Keep It"
    'billing.subscription_resumed':
      '¡Tu suscripción %strong% ha sido reanudada!', // In English: "Your %strong% subscription has been resumed!"
    'billing.upgrade_now': 'Actualizar ahora', // In English: "Upgrade Now"
    'billing.upgrade': 'Actualizar', // In English: "Upgrade"
    'billing.currently_on_free_plan': 'Actualmente estás en el plan gratuito.', // In English: "You are currently on the free plan."
    'billing.download_receipt': 'Descargar recibo', // In English: "Download Receipt"
    'billing.subscription_check_error':
      'Ocurrió un problema al verificar el estado de tu suscripción.', // In English: "A problem occurred while checking your subscription status."
    'billing.email_confirmation_needed':
      'Tu correo electrónico no ha sido confirmado. Te enviaremos un código para confirmarlo ahora.', // In English: "Your email has not been confirmed. We'll send you a code to confirm it now."
    'billing.sub_cancelled_but_valid_until':
      'Has cancelado tu suscripción y se cambiará automáticamente al nivel gratuito al final del periodo de facturación. No se te cobrará nuevamente a menos que te vuelvas a suscribir.', // In English: "You have cancelled your subscription and it will automatically switch to the free tier at the end of the billing period. You will not be charged again unless you re-subscribe."
    'billing.current_plan_until_end_of_period':
      'Tu plan actual hasta el final de este periodo de facturación.', // In English: "Your current plan until the end of this billing period."
    'billing.current_plan': 'Plan actual', // In English: "Current plan"
    'billing.cancelled_subscription_tier': 'Suscripción cancelada (%%)', // In English: "Cancelled Subscription (%%)"
    'billing.manage': 'Gestionar', // In English: "Manage"
    'billing.limited': 'Limitado', // In English: "Limited"
    'billing.expanded': 'Expandido', // In English: "Expanded"
    'billing.accelerated': 'Acelerado', // In English: "Accelerated"
    'billing.enjoy_msg':
      'Disfruta %% de almacenamiento en la nube junto con otros beneficios.', // In English: "Enjoy %% of Cloud Storage plus other benefits."
  },
}

export default es
