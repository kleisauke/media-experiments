<?php
/**
 * Plugin Name: Media Experiments
 * Plugin URI:  https://github.com/swissspidy/media-experiments
 * Description: Media Experiments
 * Version:     0.0.2
 * Author:      Pascal Birchler
 * Author URI:  https://pascalbirchler.com
 * License:     GPLv2 or later
 * License URI: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 * Text Domain: media-experiments
 * Requires at least: 6.5
 * Requires PHP: 8.0
 * GitHub Plugin URI: https://github.com/swissspidy/media-experiments
 * Primary Branch: main
 * Release Asset: true
 *
 * @package MediaExperiments
 */

/**
 * REST attachments controller.
 */
require_once __DIR__ . '/inc/class-rest-attachments-controller.php';

/**
 * BlurHash decoder.
 */
require_once __DIR__ . '/inc/class-blurhash.php';

/**
 * Plugin functions.
 */
require_once __DIR__ . '/inc/functions.php';

/**
 * Compat functions.
 */
require_once __DIR__ . '/inc/compat.php';

/**
 * Adds all plugin actions and filters.
 */
require_once __DIR__ . '/inc/default-filters.php';

register_activation_hook( __FILE__, 'MediaExperiments\\activate_plugin' );
register_deactivation_hook( __FILE__, 'MediaExperiments\\deactivate_plugin' );
