<?php
/**
 * Plugin Name: Media Platform Headless DAM Connector
 * Plugin URI:  https://github.com/luannguen/mediaflatform
 * Description: Offload WordPress Media Library to Media Platform Headless DAM with dynamic on-the-fly Sharp resizing, WebP/AVIF auto-negotiation, and global edge CDN delivery.
 * Version:     1.0.0
 * Author:      Media Platform Enterprise Team
 * License:     MIT
 * Text Domain: media-platform
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class MediaPlatformConnector {
    private static $instance = null;
    private $option_name = 'media_platform_settings';

    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Admin menu
        add_action('admin_menu', [$this, 'register_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);

        // Upload offload hook
        add_filter('wp_handle_upload', [$this, 'handle_media_upload'], 10, 2);

        // URL rewrite hook
        add_filter('wp_get_attachment_url', [$this, 'filter_attachment_url'], 10, 2);

        // Responsive downsize hook (dynamic sharp resizing)
        add_filter('image_downsize', [$this, 'filter_image_downsize'], 10, 3);
    }

    public function register_admin_menu() {
        add_options_page(
            'Media Platform DAM',
            'Media Platform DAM',
            'manage_options',
            'media-platform-dam',
            [$this, 'render_settings_page']
        );
    }

    public function register_settings() {
        register_setting($this->option_name, $this->option_name, [
            'sanitize_callback' => [$this, 'sanitize_options']
        ]);

        add_settings_section(
            'mp_general_section',
            'API & Storage Configuration',
            null,
            'media-platform-dam'
        );

        add_settings_field(
            'api_endpoint',
            'DAM Base URL',
            [$this, 'field_api_endpoint'],
            'media-platform-dam',
            'mp_general_section'
        );

        add_settings_field(
            'api_key',
            'API Access Key',
            [$this, 'field_api_key'],
            'media-platform-dam',
            'mp_general_section'
        );

        add_settings_field(
            'auto_offload',
            'Auto Offload Media',
            [$this, 'field_auto_offload'],
            'media-platform-dam',
            'mp_general_section'
        );
    }

    public function sanitize_options($input) {
        $clean = [];
        $clean['api_endpoint'] = esc_url_raw(rtrim($input['api_endpoint'] ?? '', '/'));
        $clean['api_key'] = sanitize_text_field($input['api_key'] ?? '');
        $clean['auto_offload'] = !empty($input['auto_offload']) ? 1 : 0;
        return $clean;
    }

    public function field_api_endpoint() {
        $opts = get_option($this->option_name);
        $val = esc_attr($opts['api_endpoint'] ?? 'http://localhost:3000');
        echo "<input type='text' name='{$this->option_name}[api_endpoint]' value='{$val}' class='regular-text' placeholder='https://media.yourdomain.com' />";
        echo "<p class='description'>Root URL of your Media Platform DAM instance.</p>";
    }

    public function field_api_key() {
        $opts = get_option($this->option_name);
        $val = esc_attr($opts['api_key'] ?? '');
        echo "<input type='password' name='{$this->option_name}[api_key]' value='{$val}' class='regular-text' />";
        echo "<p class='description'>API Key with upload and delivery permissions.</p>";
    }

    public function field_auto_offload() {
        $opts = get_option($this->option_name);
        $checked = !empty($opts['auto_offload']) ? 'checked' : '';
        echo "<label><input type='checkbox' name='{$this->option_name}[auto_offload]' value='1' {$checked} /> Synchronize and stream uploads via Media Platform CDN</label>";
    }

    public function render_settings_page() {
        if (!current_user_can('manage_options')) return;
        ?>
        <div class="wrap">
            <h1>Media Platform Headless DAM Connector</h1>
            <p>Connect your WordPress Media Library with high-performance Enterprise Headless DAM CDN.</p>
            <form method="post" action="options.php">
                <?php
                settings_fields($this->option_name);
                do_settings_sections('media-platform-dam');
                submit_button();
                ?>
            </form>
        </div>
        <?php
    }

    /**
     * Intercept media uploads and offload to Media Platform DAM
     */
    public function handle_media_upload($upload, $context) {
        $opts = get_option($this->option_name);
        if (empty($opts['auto_offload']) || empty($opts['api_endpoint'])) {
            return $upload;
        }

        $file_path = $upload['file'];
        $file_type = $upload['type'];

        // Only offload standard images and videos
        if (strpos($file_type, 'image/') !== 0 && strpos($file_type, 'video/') !== 0) {
            return $upload;
        }

        if (empty($opts['api_key']) || !function_exists('curl_init')) {
            $upload['error'] = 'Media Platform requires an API key and the PHP cURL extension.';
            return $upload;
        }
        $base = rtrim($opts['api_endpoint'], '/');
        $headers = ['Content-Type' => 'application/json', 'X-Media-Api-Key' => $opts['api_key']];
        $response = wp_remote_post($base . '/api/v1/uploads/sessions', [
            'headers' => $headers, 'timeout' => 30,
            'body' => wp_json_encode(['filename' => basename($file_path), 'file_size' => filesize($file_path), 'mime_type' => $file_type, 'visibility' => 'public']),
        ]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 201) {
            $upload['error'] = 'Media Platform could not reserve upload capacity.';
            return $upload;
        }
        $created = json_decode(wp_remote_retrieve_body($response), true)['data'] ?? [];
        $capability = $created['capability'] ?? [];
        $session_id = $created['session']['id'] ?? '';
        if (!$session_id || empty($capability['uploadUrl']) || wp_parse_url($capability['uploadUrl'], PHP_URL_SCHEME) !== 'https') {
            $upload['error'] = 'Media Platform returned an invalid upload capability.';
            return $upload;
        }
        $handle = fopen($file_path, 'rb');
        if ($handle === false) { $upload['error'] = 'Media Platform could not read the local file.'; return $upload; }
        $curl = curl_init($capability['uploadUrl']);
        curl_setopt_array($curl, [CURLOPT_UPLOAD => true, CURLOPT_INFILE => $handle,
            CURLOPT_INFILESIZE => filesize($file_path), CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => 300, CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => ['Content-Type: ' . $file_type], CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        $sent = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl); fclose($handle);
        if ($sent === false || $status < 200 || $status >= 300) {
            $upload['error'] = 'Media Platform storage upload failed; the local file was retained.';
            return $upload;
        }
        $response = wp_remote_post($base . '/api/v1/uploads/sessions/' . rawurlencode($session_id) . '/complete', [
            'headers' => $headers, 'timeout' => 30, 'body' => '{}',
        ]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) >= 300) {
            $upload['error'] = 'Media Platform could not finalize the upload; the local file was retained.';
            return $upload;
        }
        $body = json_decode(wp_remote_retrieve_body($response), true);
        $asset_id = $body['data']['asset']['id'] ?? '';
        if (!$asset_id) { $upload['error'] = 'Media Platform returned no asset ID.'; return $upload; }
        $upload['mp_asset_id'] = $asset_id;
        set_transient('mp_temp_asset_' . md5($file_path), $asset_id, 300);

        return $upload;
    }

    /**
     * Rewrite standard WordPress attachment URLs to DAM Delivery URLs
     */
    public function filter_attachment_url($url, $post_id) {
        $asset_id = get_post_meta($post_id, '_media_platform_asset_id', true);
        if (!$asset_id) {
            $file_path = get_attached_file($post_id);
            if ($file_path) {
                $temp_id = get_transient('mp_temp_asset_' . md5($file_path));
                if ($temp_id) {
                    update_post_meta($post_id, '_media_platform_asset_id', $temp_id);
                    delete_transient('mp_temp_asset_' . md5($file_path));
                    $asset_id = $temp_id;
                }
            }
        }

        if ($asset_id) {
            $opts = get_option($this->option_name);
            $base = $opts['api_endpoint'] ?? 'http://localhost:3000';
            return rtrim($base, '/') . '/api/v1/delivery/' . $asset_id;
        }

        return $url;
    }

    /**
     * Intercept responsive thumbnail sizing to request on-the-fly Sharp crops from DAM
     */
    public function filter_image_downsize($downsize, $post_id, $size) {
        $asset_id = get_post_meta($post_id, '_media_platform_asset_id', true);
        if (!$asset_id) return false;

        $opts = get_option($this->option_name);
        $base = rtrim($opts['api_endpoint'] ?? 'http://localhost:3000', '/');

        $width = 0;
        $height = 0;
        $crop = true;

        if (is_array($size)) {
            $width = (int) $size[0];
            $height = (int) ($size[1] ?? 0);
        } elseif (is_string($size)) {
            global $_wp_additional_image_sizes;
            if (isset($_wp_additional_image_sizes[$size])) {
                $width = (int) $_wp_additional_image_sizes[$size]['width'];
                $height = (int) $_wp_additional_image_sizes[$size]['height'];
                $crop = !empty($_wp_additional_image_sizes[$size]['crop']);
            } elseif (in_array($size, ['thumbnail', 'medium', 'large'])) {
                $width = (int) get_option("{$size}_size_w");
                $height = (int) get_option("{$size}_size_h");
                $crop = (bool) get_option("{$size}_crop");
            }
        }

        $query = ['format' => 'webp'];
        if ($width > 0) $query['width'] = $width;
        if ($height > 0) $query['height'] = $height;
        if ($crop) $query['fit'] = 'focal';

        $delivery_url = $base . '/api/v1/delivery/' . $asset_id . '?' . http_build_query($query);
        return [$delivery_url, $width, $height, true];
    }
}

add_action('plugins_loaded', ['MediaPlatformConnector', 'get_instance']);
