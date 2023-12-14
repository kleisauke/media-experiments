<?php
/**
 * Single upload request template.
 *
 * @package MediaExperiments
 */

	$post = get_post();

if ( $post instanceof WP_Post ) {
	global $authordata;
	$authordata = get_userdata( (int) $post->post_author );
}

	$mexp_request_parent     = $post instanceof WP_Post && $post->post_parent > 0 ? get_post( $post->post_parent ) : null;
	$mexp_request_parent_url = $mexp_request_parent instanceof WP_Post && ( is_post_publicly_viewable( $mexp_request_parent ) || current_user_can( 'read', $mexp_request_parent ) ) ? get_permalink( $mexp_request_parent ) : null;
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta http-equiv="Content-Type" content="<?php bloginfo( 'html_type' ); ?>; charset=<?php bloginfo( 'charset' ); ?>" />
	<title><?php esc_html_e( 'Media Upload Request', 'media-experiments' ); ?></title>
	<meta name="robots" content="noindex" />
	<meta name="viewport" content="width=device-width" />
	<?php
	wp_enqueue_script( 'media-experiments-view-upload-request' );
	wp_enqueue_style( 'media-experiments-view-upload-request' );

	$wp_scripts = wp_scripts();

	// Prevent errors caused by persistence layer trying to read
	// preferences from /wp/v2/users/me.
	if ( ! is_user_logged_in() ) {
		$dep = $wp_scripts->registered['wp-preferences']; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
		$wp_scripts->remove( 'wp-preferences' );
		$wp_scripts->add( 'wp-preferences', $dep->src, $dep->deps, $dep->ver );
		unset( $dep );
	}

	// TODO: Only provide mime types allowed for this upload request.
	wp_add_inline_script(
		'media-experiments-view-upload-request',
		sprintf(
			'
			window.mediaExperiments.allowedMimeTypes = %1$s;
			window.mediaExperiments.uploadRequest = %2$s;',
			wp_json_encode( get_allowed_mime_types() ),
			wp_json_encode( $post?->post_name )
		),
		'before'
	);

	$wp_scripts->do_items( [ 'media-experiments-view-upload-request' ] );

	$wp_styles = wp_styles();
	$wp_styles->do_items( [ 'media-experiments-view-upload-request' ] );
	?>
	<style>
		.single-mexp-upload-request .outer-wrap h1 a {
			background-image: none, url(<?php echo admin_url( 'images/wordpress-logo.svg' ); ?>);
		}
	</style>
</head>
<body <?php body_class( 'no-js' ); ?>>
<?php
wp_print_inline_script_tag( "document.body.className = document.body.className.replace('no-js','js');" );
?>
<div class="outer-wrap">
	<h1><a href="<?php echo esc_url( home_url() ); ?>"><?php esc_html_e( 'Media Upload Request', 'media-experiments' ); ?></a></h1>
	<div class="inner-wrap">
		<p>
			<?php
			if ( ! $mexp_request_parent instanceof WP_Post ) {
				printf(
					'%s would like you to upload a file to their site. Please choose a file below.',
					get_the_author(),
				);
			} elseif ( is_string( $mexp_request_parent_url ) ) {
				printf(
					'%1$s would like you to upload a file to their post <a href="%2$s">%3$s</a>. Please choose a file below.',
					get_the_author(),
					esc_url( $mexp_request_parent_url ),
					get_the_title( $mexp_request_parent ),
				);
			} else {
				printf(
					'%1$s would like you to upload a file to their post "%2$s". Please choose a file below.',
					get_the_author(),
					get_the_title( $mexp_request_parent ),
				);
			}
			?>
		</p>
		<div class="hide-if-no-js" id="media-experiments-upload-request-root"></div>
		<p class="hide-if-js">
			<?php esc_html_e( 'This functionality requires JavaScript. Please enable JavaScript in your browser settings.', 'media-experiments' ); ?>
		</p>
	</div>
</div>

</body>
</html>
