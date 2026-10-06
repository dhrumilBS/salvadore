/**
 * Author: Shadow Themes
 * Author URL: https://shadow-themes.com
 */
"use strict";

// Core Options
const bringer_config = {
    // Smooth Scroll
    smoothScroll: false,

    // Main Logo Size
    logo_size: {
        w: 88,
        h: 24
    },

    // Cursor Following
    cursorFollow: '.bringer-socials-list a, .bringer-gallery-nav',

    // Links Exception
    linksException: [
        '.comment-reply-link',
        '.shadowcore-lightbox-link',
        '.bringer-lightbox-link',
        '.bringer-noanim-link'
    ]
}

/// ----------------
/// Template Scripts 
/// ----------------
jQuery(function ($) {
    // Define Template Core
    const core = new ST_Core( bringer_config );

    // Define Template Object
    const template = {
        inView: function( this_el ) {
            let rect = this_el.getBoundingClientRect()
            return (
                ( rect.height > 0 || rect.width > 0) &&
                rect.bottom >= 0 &&
                rect.right >= 0 &&
                rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
                rect.left <= (window.innerWidth || document.documentElement.clientWidth)
            )
        }
    };

    // --- CUSTOM FUNCTION --- //
    function CustomFunction() {
        // Put your custom JS code here
    }

    // --- RIGHT CLICK PROTECTION //
    function RightClickProtection( selector ) {
        if ( jQuery(selector).length ) {
            let $this = jQuery(selector);
            let rcp_message = $this.children().length ? true : false;
            let rcp_timer = null;
            jQuery(document).on('contextmenu', function(e) {
                if ( rcp_timer !== null ) {
                    clearInterval(rcp_timer);
                }
                e.preventDefault();
                if ( rcp_message ) {
                    document.body.classList.add('rcp-show');
                    rcp_timer = setInterval(function() {
                        document.body.classList.remove('rcp-show');
                        clearInterval(rcp_timer);
                    }, 2000);
                }
            });
            if ( rcp_message ) {
                $this.on('click', function(e) {
                    e.preventDefault();
                    document.body.classList.remove('rcp-show');
                });
            }

            jQuery(document).on('keyup', function(e) {
                if (e.keyCode === 27) {
                    if ( document.body.classList.contains('rcp-show') ) {
                        document.body.classList.remove('rcp-show');
                    }
                }
            });
        }
    }

    // --- MAIN MENU --- //
    function MainMenuInit() {
        template.menu = new Bringer_Menu( core );
    }

    // --- PHOTOSWITE LIGHTBOX --- //
    function initPSWP() {
        if ( jQuery('.bringer-lightbox-link').length ) {
            if ( typeof PhotoSwipe === 'function' ) {
                // Define PSWP Object
                template.pswp = {
                    isReady: typeof PhotoSwipe === 'function' ? true : false,
                    getMaxHeight : function() {
                        let maxHeight = core.sizes.win;
                        if ( jQuery('.pswp__caption').length ) {
                            maxHeight = maxHeight - jQuery('.pswp__caption').height();
                        }
                        if ( jQuery('.pswp__top-bar').length ) {
                            let $top_bar = jQuery('.pswp__top-bar'),
                                top_bar_height = $top_bar.height() + parseInt($top_bar.css('padding-top'), 10) + parseInt($top_bar.css('padding-bottom'), 10);

                            if ( jQuery('.pswp__caption').length ) {
                                maxHeight = maxHeight - top_bar_height;
                            } else {
                                maxHeight = maxHeight - top_bar_height*2;
                            }
                        }
                        return maxHeight;
                    },
                    // Resize Video
                    resizeVideo : function() {
                        let result = {};
                        if ( window.innerWidth/16 > this.getMaxHeight()/9 ) {
                            result.w = this.getMaxHeight() * 1.7778 * 0.8;
                            result.h = this.getMaxHeight() * 0.8;
                        } else {
                            result.w = window.innerWidth * 0.8;
                            result.h = window.innerWidth * 0.5625 * 0.8;
                        }
                        return result;
                    },
                    gallery : Array(),
                    dom : jQuery('\
                    <!-- Root element of PhotoSwipe. Must have class pswp. -->\
                    <div class="pswp" tabindex="-1" role="dialog" aria-hidden="true">\
                        <div class="pswp__bg"></div><!-- PSWP Background -->\
                        \
                        <div class="pswp__scroll-wrap">\
                            <div class="pswp__container">\
                                <div class="pswp__item"></div>\
                                <div class="pswp__item"></div>\
                                <div class="pswp__item"></div>\
                            </div><!-- .pswp__container -->\
                            \
                            <div class="pswp__ui pswp__ui--hidden">\
                                <div class="pswp__top-bar">\
                                    <!--  Controls are self-explanatory. Order can be changed. -->\
                                    <div class="pswp__counter"></div>\
                                    \
                                    <button class="pswp__button pswp__button--close bringer-pswp-close" title="Close (Esc)">\
                                        <i></i>\
                                    </button>\
                                    \
                                    <div class="pswp__preloader">\
                                        <div class="pswp__preloader__icn">\
                                        <div class="pswp__preloader__cut">\
                                            <div class="pswp__preloader__donut"></div>\
                                        </div><!-- .pswp__preloader__cut -->\
                                        </div><!-- .pswp__preloader__icn -->\
                                    </div><!-- .pswp__preloader -->\
                                </div><!-- .pswp__top-bar -->\
                                \
                                <div class="pswp__share-modal pswp__share-modal--hidden pswp__single-tap">\
                                    <div class="pswp__share-tooltip"></div>\
                                </div><!-- .pswp__share-modal -->\
                                \
                                <button class="pswp__button bringer-pswp-nav bringer-pswp-prev pswp__button--arrow--left" title="Previous (arrow left)"></button>\
                                <button class="pswp__button bringer-pswp-nav bringer-pswp-next pswp__button--arrow--right" title="Next (arrow right)"></button>\
                                \
                                <div class="pswp__caption">\
                                    <div class="pswp__caption__center"></div>\
                                </div><!-- .pswp__caption -->\
                            </div><!-- .pswp__ui pswp__ui--hidden -->\
                        </div><!-- .pswp__scroll-wrap -->\
                    </div><!-- .pswp -->').appendTo( core.$dom.body )
                };

                // Build PSWP Gallery
                jQuery('.bringer-lightbox-link').each(function() {
                    let $this = jQuery(this),
                        this_item = {},
                        this_gallery = $this.attr('data-gallery') ? $this.attr('data-gallery') : 'default';

                    // Get Slide Type
                    if ( $this.attr('data-type') && $this.attr( 'data-type' ) !== 'image' ) {
                        // Video Slide
                        if ( 'video' === $this.attr('data-type') ) {
                            this_item.html = '\
                            <div class="bringer-pswp-media--video" data-src="' + $this.attr('href') + '">\
                                <video src="' + $this.attr('href') + '" controls webkit-playsinline="true" playsinline="true"></video>\
                            </div>';
                        } else {
                            let this_type, this_link;
                            if ( $this.attr('href').indexOf('imeo.com') > 0 ) {
                                let href_split = $this.attr('href').split('/');
                                this_type = 'vimeo';
                                this_link = 'https://player.vimeo.com/video/' + (href_split[href_split.length - 1].length ? href_split[href_split.length - 1] : href_split[href_split.length - 2]);
                            } else if ( $this.attr('href').indexOf('outu') > 0 ) {
                                this_type = 'youtube';
                                let href_split;
                                if ($this.attr('href').indexOf('v=') > 0){
                                    href_split = $this.attr('href').split('v=');
                                } else {
                                    href_split = $this.attr('href').split('/');
                                }
                                let this_vid = href_split[href_split.length - 1].length ? href_split[href_split.length - 1] : href_split[href_split.length - 2];
                                if ( this_vid.indexOf('?') ) {
                                    this_vid = this_vid.split('?')[0];
                                }
                                if ( this_vid.indexOf('&') ) {
                                    this_vid = this_vid.split('&')[0];
                                }
                                this_link = 'https://www.youtube.com/embed/' + this_vid;
                            }
                            this_item.html = '\
                            <div class="bringer-pswp-media--iframe" data-player-src="'+ this_link +'" data-src="' + $this.attr('href') + '" data-type="' + this_type + '">\
                                <iframe src="' + this_link + '?controls=1&amp;loop=0"></iframe>\
                            </div>';
                        }
                    } else {
                        // Image Slide
                        if ( $this.attr('data-size') ) {
                            let item_size = $this.attr('data-size').split('x');
                            this_item.w = item_size[0];
                            this_item.h = item_size[1];
                        } else {
                            if ( $this.children('img').attr('width'))
                                this_item.w = $this.children('img').attr('width');
                            if ( $this.children('img').attr('height'))
                                this_item.w = $this.children('img').attr('height');
                        }
                        this_item.src = $this.attr('href');
                    }

                    // Get Slide Caption
                    if ( $this.attr('data-caption') ) {
                        this_item.title = $this.attr('data-caption');
                    } else if ( $this.attr('title') ) {
                        this_item.title = $this.attr('title');
                    }

                    // Insert Item to Gallery
                    if ( template.pswp.gallery[this_gallery] ) {
                        template.pswp.gallery[this_gallery].push(this_item);
                    } else {
                        template.pswp.gallery[this_gallery] = [];
                        template.pswp.gallery[this_gallery].push(this_item);
                    }

                    // Update Index
                    $this.attr('data-count', template.pswp.gallery[this_gallery].length - 1);
                });

                core.$dom.body.on('click', '.pswp__scroll-wrap', function(e) {
                    if ( template.pswp.lightbox ) {
                        template.pswp.lightbox.close();
                    }
                });
                core.$dom.body.on('click', '.bringer-pswp-image-wrap', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                });
                core.$dom.body.on('click', '.pswp__scroll-wrap button, .pswp__scroll-wrap a, .pswp__scroll-wrap img', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                });

                jQuery(document).on('click', '.bringer-lightbox-link', function(e) {
                    e.preventDefault();
                    if (typeof PhotoSwipe === 'function') {
                        let $this = jQuery(this),
                            this_index = parseInt($this.attr('data-count'), 10),
                            this_gallery = $this.attr('data-gallery') ? $this.attr('data-gallery') : 'default',
                            this_options = {
                                index: this_index,
                                history: false,
                                bgOpacity: 0.9,
                                showHideOpacity: true,
                                getThumbBoundsFn: function(index) {
                                    var pageYScroll = window.pageYOffset || document.documentElement.scrollTop,
                                        rect = $this[0].getBoundingClientRect();

                                    return {x:rect.left, y:rect.top + pageYScroll, w:rect.width};
                                },
                            };

                        template.pswp.lightbox = new PhotoSwipe( core.$dom.body.find('.pswp')[0], PhotoSwipeUI_Default, template.pswp.gallery[this_gallery], this_options );
                        template.pswp.lightbox.init();

                        // Init video (if is video slide)
                        if ($this.attr('data-type') !== 'image') {
                            let $this_video = jQuery(template.pswp.lightbox.container).find('[data-src="'+ $this.attr('href') +'"]');
                            $this_video.addClass('is-inview').width(template.pswp.resizeVideo().w).height(template.pswp.resizeVideo().h);
                            if ( 'video' === $this.attr('data-type') ) {
                                if ( $this_video.children('video').length ) {
                                    $this_video.children('video').attr('autoplay', true);
                                }
                            } else {
                                if ( $this_video.children('iframe').length ) {
                                    $this_video.children('iframe').attr('src', $this_video.attr('data-player-src')+'?controls=1&amp;loop=0&amp;autoplay=1&amp;' + ($this_video.attr('data-type') === 'vimeo' ? 'muted' : 'mute') + '=1');
                                }
                            }
                        }

                        // Check for videos in view
                        template.pswp.lightbox.listen('resize', function() {
                            if ( jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--video').length ) {
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--video').width(template.pswp.resizeVideo().w).height(template.pswp.resizeVideo().h);
                            }
                            if ( jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--iframe').length ) {
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--iframe').width(template.pswp.resizeVideo().w).height(template.pswp.resizeVideo().h);
                            }
                        });

                        template.pswp.lightbox.listen('beforeChange', function() {
                            // Self-hosted Video
                            if ( jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--video').length ) {
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--video').width(template.pswp.resizeVideo().w).height(template.pswp.resizeVideo().h);
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--video').each(function() {
                                    if ( template.inView( this ) ) {
                                        jQuery(this).addClass('is-inview');
                                        if ( jQuery(this).children('video').length ) {
                                            jQuery(this).children('video')[0].play();
                                        }
                                    } else {
                                        jQuery(this).removeClass('is-inview');
                                        if ( jQuery(this).children('video').length ) {
                                            jQuery(this).children('video')[0].pause();
                                        }
                                    }
                                });
                            }
                            // Embedded Video
                            if ( jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--iframe').length ) {
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--iframe').width(template.pswp.resizeVideo().w).height(template.pswp.resizeVideo().h);
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--iframe').each(function() {
                                    let $this_video = jQuery(this);
                                    if ( template.inView( this ) ) {
                                        $this_video.addClass('is-inview');
                                        $this_video.children('iframe').attr('src', $this_video.attr('data-player-src')+'?controls=1&amp;loop=0&amp;autoplay=1&amp;muted=1');
                                    } else {
                                        $this_video.removeClass('is-inview');
                                        $this_video.children('iframe').attr( 'src', jQuery(this).attr('data-src') + '?controls=1&amp;loop=0' );
                                    }
                                });
                            }
                        });

                        template.pswp.lightbox.listen('close', function() {
                            // Close ligthbox
                            if ( jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--iframe').length ) {
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--iframe').each(function() {
                                    if ( jQuery(this).children('iframe').length ) {
                                        jQuery(this).children('iframe').attr( 'src', jQuery(this).attr('data-src') + '?controls=1&amp;loop=0' );
                                    }
                                });
                            }
                        });

                        template.pswp.lightbox.listen('unbindEvents', function() {
                            // Unbind Events after close
                        });
                        template.pswp.lightbox.listen('destroy', function() {
                            // Destroy after unbind close
                            if ( jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--video').length ) {
                                jQuery(template.pswp.lightbox.container).find('.bringer-pswp-media--video').each(function() {
                                    if ( jQuery(this).children('video').length ) {
                                        jQuery(this).children('video')[0].pause();
                                    }
                                });
                            }
                        });
                    } else {
                        console.warn('PhotoSwipe not loaded');
                    }
                });
            } else {
                console.error('Bringer Error: PSWP script not found.');
            }
        }
    }

    // --- HERO SECTIONS --- //
    function HeroSections() {
        // Masked Blocks
        if ( jQuery('.bringer-masked-block').length ) {
            jQuery('.bringer-masked-block').each(function() {
                new Bringer_Masked(this);
            });
        }
    }

    // --- HIGHLIGHT BLOCKS --- //
    function BlocksHighlight() {
        if ( jQuery('.bringer-backlight').length ) {
            template.cursor_pos = {
                x: 0,
                y: 0
            }
            jQuery(document).on('mousemove', function(e) {
                template.cursor_pos.x = e.clientX;
                template.cursor_pos.y = e.clientY;
                jQuery('.bringer-backlight').css({
                    '--mouse-x': `${template.cursor_pos.x}px`,
                    '--mouse-y': `${template.cursor_pos.y}px`,
                });
            });

            if ( jQuery('.bringer-block').length ) {
                jQuery('.bringer-block').each(function() {
                    let $item = jQuery(this);
                    $item.update = function() {
                        if ( !core.isTouchDevice ) {
                            const rect = $item[0].getBoundingClientRect();
                            if (( rect.height > 0 || rect.width > 0) &&
                            rect.bottom >= 0 &&
                            rect.right >= 0 &&
                            rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
                            rect.left <= (window.innerWidth || document.documentElement.clientWidth)) {
                                let this_x = template.cursor_pos.x - rect.left,
                                    this_y = template.cursor_pos.y - rect.top;
                                $item.css({
                                    '--mouse-x': this_x + 'px',
                                    '--mouse-y': this_y + 'px',
                                });
                            }
                        }
                    }
                    $item.isReady = true;
                    core.updateRequired.push( $item );
                });
            }
        }
    }

    // --- MARQUEE ELEMENT --- //
    function Marquee() {
        if ( jQuery('.bringer-marquee').length ) {
            jQuery('.bringer-marquee').each(function() {
                new Bringer_Marquee(this);
            });
        }
    }

    // --- SWIPER GALLERY --- //
    function SwiperGallery() {
        if ( jQuery('.swiper').length ) {
            // Init Swiper Elements
            const init_swiper = function() {
                if ( ! template.hasOwnProperty('swiper') ) {
                    template.swiper = [];
                }
                jQuery('.swiper').each(function() {
                    let $this = jQuery(this);
                    if ( $this.attr('data-id') === undefined ) {
                        $this.attr('data-id', core.utils.generateID());
                    }
                    let this_id = $this.attr('data-id');
                    let options = {
                        direction: 'horizontal',
                        loop: true,
                        speed: $this.attr('data-duration') !== undefined ? parseInt($this.attr('data-duration'), 10) : 500,
                        autoHeight: false,
                        grabCursor: true,
                        breakpoints: {

                        }
                    }
                    if ( core.$dom.body.hasClass('bringer-fullscreen-page') ) {
                        options.mousewheel = true;
                    }
                    // CAROUSEL
                    if ( $this.hasClass('bringer-carousel') ) {
                        // Center if low slides count
                        options.centerInsufficientSlides = true; 
                        // Active slide is at the center
                        options.centeredSlides = true;
                        // Spacing
                        options.spaceBetween = parseInt($this.css('--swiper-gap'));
                        // Effect
                        if ( $this.attr('data-effect') !== undefined ) {
                            options.effect = $this.attr('data-effect');
                        }
                        // Mobile per View
                        options.slidesPerView = $this.attr('data-m-count') !== undefined ? parseFloat($this.attr('data-m-count')) : 1;
                        options.breakpoints = {
                            739: {
                                // Tabled Port
                                slidesPerView: $this.attr('data-tp-count') !== undefined ? parseFloat($this.attr('data-tp-count')) : 2,
                                centeredSlides: $this.attr('data-tp-centered') !== undefined ? parseInt($this.attr('data-tp-centered'), 10) : true,
                            },
                            960: {
                                // Tabled Land
                                slidesPerView: $this.attr('data-t-count') !== undefined ? parseFloat($this.attr('data-t-count')) : 3,
                                centeredSlides: $this.attr('data-t-centered') !== undefined ? parseInt($this.attr('data-t-centered'), 10) : true,
                            },
                            1200: {
                                // Desktop
                                slidesPerView: $this.attr('data-count') !== undefined ? parseFloat($this.attr('data-count')) : 3,
                                centeredSlides: $this.attr('data-centered') !== undefined ? parseInt($this.attr('data-centered'), 10) : true,
                            }
                        };
                    }
                    
                    // SLIDER
                    if ( $this.hasClass('bringer-slider') ) {
                        options.slidesPerView = 1;
                        options.parallax = true;
                        options.autoplay = $this.attr('data-autoplay') !== undefined ? { delay: parseInt($this.attr('data-autoplay'), 10) } : false;
                        options.effect = $this.attr('data-effect') !== undefined ? $this.attr('data-effect') : 'slide';

                        // Fullscreen Slider
                        if ( core.$dom.body.hasClass('bringer-fullscreen-page') ) {
                            options.autoHeight = false;
                        }

                        // Slider Content
                        if ( $this.find('.bringer-slide-content').length ) {
                            let content_mask_id = 'mask_' + Math.random().toString(36).substr(2, 9);
                            $this.children('.swiper-wrapper').children('.swiper-slide').each(function(i) {
                                let $slide = jQuery(this);
                                if ( $slide.children('.bringer-slide-content').length ) {
                                    const $slide_content = $slide.children('.bringer-slide-content');
                                    $slide.addClass('has-content');
                                    let $media;
                                    if ( $slide.children('.st-lazy-wrapper').length ) {
                                        $media = $slide.children('.st-lazy-wrapper');
                                    } else {
                                        $media = $slide.children('video').length ? $slide.children('video') : $slide.children('img');
                                    }
                                    $media.wrap('<div class="bringer-slider-media"/>');
                                    const content_mask_path = function() {
                                        let tw = $slide.width(),
                                            th = $slide.height(),
                                            cw = $slide_content.width(),
                                            ch = $slide_content.height(),
                                            ctp = th - ch, // Content Top Point
                                            cpl = 0.5 * (tw - cw), // Content Point Left
                                            cpr = cpl + cw, // Content Point Right
                                            br = parseInt($slide.css('--masked-border-radius'), 10),
                                            ibr = parseInt($slide.css('--masked-inner-radius'), 10),
                                            path = `
                                            M0,0 
                                            L${tw},0 
                                            L${tw},${th} 
                                            L${(cpr + br)},${th} 
                                            a${br},${br} 0 0 1 -${br},-${br} 
                                            L${cpr},${ctp + ibr} 
                                            a${ibr},${ibr} 0 0 0 -${ibr},${-ibr} 
                                            L${cpl+ibr},${ctp} 
                                            a${ibr},${ibr} 0 0 0 -${ibr},${ibr} 
                                            L${cpl}, ${(th - br)} 
                                            a${br},${br} 0 0 1 -${br},${br} 
                                            L0,${th} 
                                            Z
                                            `;
                                            $slide_content.css('left', cpl);
                                        return path;
                                    }
                                    const update_content_mask = function() {
                                        $content_path.attr('d', content_mask_path());
                                    }
                                    const $content_mask = jQuery(`
                                    <svg width="0" height="0">
                                        <defs>
                                            <clipPath id="${(content_mask_id + i)}">
                                                <path d="${content_mask_path()}"/>
                                            </clipPath>
                                        </defs>
                                    </svg>`),
                                    $content_path = $content_mask.children('defs').children('clipPath').children('path');
                                    $slide.append($content_mask);
                                    $slide.children('.bringer-slider-media').css('clip-path', `url(#${(content_mask_id + i)})`);

                                    // Update Function
                                    jQuery(window).on('resize', function() {
                                        setTimeout(function() {
                                            update_content_mask();
                                        }, 100, update_content_mask);
                                    }).on('load', function() {
                                        update_content_mask();
                                    });
                                }
                            });
                        }
                    }
                    // Pagination
                    if ( $this.children('.bringer-dots').length ) {
                        options.pagination = {
                            el: '.bringer-dots',
                            dynamicBullets: true,
                            dynamicMainBullets: 1,
                            clickable: true
                        }
                    }
                    // Slider Navigation
                    if ( $this.parent().children('.bringer-slider-nav').length ) {
                        let $this_nav = $this.parent().children('.bringer-slider-nav');
                        options.navigation = {
                            prevEl: $this_nav.children('.bringer-slider-prev')[0],
                            nextEl: $this_nav.children('.bringer-slider-next')[0],
                        }
                        if ( $this_nav.hasClass('on-sides') ) {
                            const this_path = function() {
                                let ny_t = parseInt($this_nav.css('top'),10),
                                    ny_h = $this_nav.height(),
                                    tw = $this.width(),
                                    th = $this.height(),
                                    br = parseInt($this_nav.css('--masked-border-radius'), 10),
                                    ibr = parseInt($this_nav.css('--masked-inner-radius'), 10),
                                    path = `
                                    M0,${br} 
                                    a${br},${br} 0 0 1 ${br},-${br} 
                                    L${(tw - br)},0 
                                    a${br},${br} 0 0 1 ${br},${br} 
                                    L${tw},${(ny_t - br)} 

                                    a${br},${br} 0 0 1 -${br},${br} 
                                    a${ibr},${ibr} 0 0 0 -${ibr},${ibr} 
                                    a${ibr},${ibr} 0 0 0 ${ibr},${ibr} 
                                    a${br},${br} 0 0 1 ${br},${br} 

                                    L${tw},${(th - br)} 
                                    a${br},${br} 0 0 1 -${br},${br} 
                                    L${br},${th} 
                                    a${br},${br} 0 0 1 -${br},-${br} 

                                    L0,${(ny_t + ny_h + br)} 
                                    a${br},${br} 0 0 1 ${br},-${br} 
                                    a${ibr},${ibr} 0 0 0 ${ibr},-${ibr} 
                                    a${ibr},${ibr} 0 0 0 -${ibr},-${ibr} 
                                    a${br},${br} 0 0 1 -${br},-${br} 
                                    Z
                                    `;
                                return path;
                            }
                            const update_mask = function() {
                                let svg_path = this_path();
                                $path.attr('d', svg_path);
                            }
                            let mask_id = 'mask_' + Math.random().toString(36).substr(2, 9),
                                $mask = jQuery(`
                                <svg width="0" height="0">
                                    <defs>
                                        <clipPath id="${mask_id}">
                                            <path d="${this_path()}"/>
                                        </clipPath>
                                    </defs>
                                </svg>`),
                                $path = $mask.children('defs').children('clipPath').children('path');
                            $this.parent().append($mask);
                            $this.css('clip-path', `url(#${mask_id})`);
                            jQuery(window).on('resize', function() {
                                setTimeout(function() {
                                    update_mask();
                                }, 100, update_mask);
                            });
                        }
                    }

                    // Init Swiper
                    template.swiper[this_id] = new Swiper(this, options);
                });
            }

            if ( typeof Swiper === 'function' ) {
                init_swiper();
            } else {
                console.error('Bringer Error: Swiper Library not found.')
            }
        }
    }

    // --- CIRCLE LINKS --- //
    function CircleLinks() {
        if ( jQuery('.bringer-circle-path-link:not(.is-init)').length ) {
            jQuery('.bringer-circle-path-link:not(.is-init)').each(function() {
                let $this = jQuery(this),
                    size = ($this.attr('data-size') !== undefined ? parseInt($this.attr('data-size'), 10) : 100),
                    r = ($this.attr('data-radius') !== undefined ? parseInt($this.attr('data-radius'), 10) : 30),
                    d = 2 * r,
                    sP = 0.5 * ( size - d ),
                    cX = r + sP,
                    cY = d + sP;
                $this.width(size).height(size);
                $this.append(`
                <svg xmlns="http://www.w3.org/2000/svg" xml:Land="en" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${size} ${size}">
                    <defs>
                        <path id="textcircle" d="M${cX}, ${cY}, a${r}, ${r} 0 0, 1 0, -${d}a${r}, ${r} 0 0, 1 0, ${d}Z"/>
                    </defs>
                    <text>
                        <textpath xlink:href="#textcircle" textLength="${parseFloat(Math.PI * d).toFixed(2)}">
                            ${$this.children('span').html()}
                        </textpath>
                    </text>
                </svg>
                `);
            });
        }    
    }

    // --- LINKS EVENTS --- //
    function LinksEvents() {
        jQuery('.bringer-back-to-listing').on('click', function() {
            window.localStorage.setItem('bringer_return_from', this.getAttribute('data-id'));
        });
        if ( jQuery('.bringer-albums-listing').length && window.localStorage.getItem('bringer_return_from') != false ) {
            jQuery(window).trigger( 'bringer_set_album', window.localStorage.getItem('bringer_return_from') );
            window.localStorage.setItem('bringer_return_from', 0);
        } else {
            window.localStorage.setItem('bringer_return_from', 0);
        }
    }

    // --- INFINITE LIST --- //
    function InfiniteList() {
        if ( jQuery('.bringer-infinite-list-wrap:not(.is-init)').length ) {
            jQuery('.bringer-infinite-list-wrap:not(.is-init)').each(function() {
                this.classList.add('is-init');
                core.updateRequired.push( new Bringer_Infinite_List(this) );
            })
        }
    }
    
    // --- COUNTERS --- //
    function Counters() {
        if ( jQuery('.bringer-counter:not(.is-init)').length ) {
            jQuery('.bringer-counter:not(.is-init)').each(function() {
                let $this = jQuery(this);
                this.classList.add('is-init');
                this.counter_count = function() {
                    let $counter = $this.children('.bringer-counter-number');
                    $counter.prop('Counter', 0).animate({
                        Counter: $counter.text()
                    }, {
                        duration: parseInt($this.attr('data-delay'), 10),
                        easing: 'swing',
                        step: function (now) {
                            $counter.text(Math.ceil(now));
                        }
                    });
                }
                if ( core.observer !== null ) {
                    this.intersected = function() {
                        this.classList.add('is-done')
                        this.counter_count();
                        core.observer.unobserve( this );
                    }
                    core.observer.observe(this);
                } else {
                    this.counter_count();
                }
            });
        }
    }

    // --- LIST WITH PREVIEW --- //
    function ListWithPreview() {
        if ( jQuery('.bringer-list-with-preview').length ) {
            jQuery('.bringer-list-with-preview').each(function() {
                new Bringer_LWP(this);
            });
        }
    }

    // --- BEFORE AND AFTER --- //
    function BeforeAfter() {
        if ( jQuery('.bringer-before-after:not(.is-init)').length ) {
            jQuery('.bringer-before-after:not(.is-init)').each(function() {
                jQuery(this).addClass('is-init');
                core.updateRequired.push( new Bringer_Before_After(jQuery(this)) );
            });
        }
    }
    
    // --- TOGGLES --- //
    function Toggles() {
        if ( jQuery('.bringer-toggles-item:not(.is-init)').length ) {
            jQuery('.bringer-toggles-item:not(.is-init)').each(function() {
                let $this = jQuery(this);
                $this.addClass('is-init');
                $this.children('.bringer-toggles-item--title').append('<i class="bringer-icon bringer-icon-arrow-down"/>');
                $this.children('.bringer-toggles-item--content').slideUp(1);
                $this.on('click', function() {
                    jQuery(this).toggleClass('is-active');
                    $this.children('.bringer-toggles-item--content').slideToggle(300);
                });
                $this.on('click', '.bringer-toggles-item--content', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                });
            });
        }
    }

    // --- SCROLL BASED ELEMENTS --- //
    function ScrollTrigger() {
        // Horizontal Scroll Ribbon
        if ( jQuery('.bringer-inline-ribbon:not(.is-init)').length ) {
            jQuery('.bringer-inline-ribbon:not(.is-init)').each(function() {
                if ( core.sap !== null ) {
                    let $this = jQuery(this);
                    $this.addClass('is-init');
                    core.sap.addHorizontalScrollItem($this, {});
                }
            });
        }

        // Sticky Elements
        if ( jQuery('.bringer-sticky-block:not(.is-init)').length ) {
            jQuery('.bringer-sticky-block:not(.is-init)').each(function() {
                if ( core.sap !== null ) {
                    let $this = jQuery(this);
                    $this.addClass('is-init');
                    core.sap.addStickyItem($this, {
                        // Related to the screen: top, center, bottom; header; px; %
                        position: ( $this.attr('data-sticky-position') !== undefined ? $this.attr('data-sticky-position') : 'center'),
                        // where start calculation in %. If not specified (or is null), will depend on position: top/header/px/% - 0%, center: 50%, bottom - 100%
                        origin: ( $this.attr('data-sticky-origin') !== undefined ? $this.attr('data-sticky-origin') : null), 
                    });
                }
            });
        }
        
        // Speed Control
        if ( jQuery('[data-speed]:not(.is-init)').length ) {
            jQuery('[data-speed]:not(.is-init)').each(function() {
                if ( core.sap !== null ) {
                    let $this = jQuery(this);
                    $this.addClass('is-init');
                    let spd = $this.attr('data-speed');
                    core.sap.addSpeedItem( $this, {
                        speed: spd,
                        l_speed: $this.attr('data-l-speed') !== undefined ? $this.attr('data-l-speed') : spd,
                        t_speed: $this.attr('data-t-speed') !== undefined ? $this.attr('data-t-speed') : spd,
                        tp_speed: $this.attr('data-tp-speed') !== undefined ? $this.attr('data-tp-speed') : spd,
                        m_speed: $this.attr('data-m-speed') !== undefined ? $this.attr('data-m-speed') : spd,
                    });
                }
            });
        }

        // Expand on Scroll
        if ( jQuery('.bringer-expand-on-scroll:not(.is-init)').length ) {
            jQuery('.bringer-expand-on-scroll:not(.is-init)').each(function() {
                if ( core.sap !== null ) {
                    let $this = jQuery(this);
                    $this.addClass('is-init');
                    core.sap.addExpandItem($this, {
                        // Related to the screen: top, center, bottom; header; px; %
                        position: ( $this.attr('data-sticky-position') !== undefined ? $this.attr('data-sticky-position') : 'center'),
                        // where start calculation in %. If not specified (or is null), will depend on position: top/header/px/% - 0%, center: 50%, bottom - 100%
                        origin: ( $this.attr('data-sticky-origin') !== undefined ? $this.attr('data-sticky-origin') : null), 
                    });
                }
            });
        }

        // Text Mask Fill
        if ( jQuery('.bringer-text-fill-mask:not(.is-init)').length ) {
            jQuery('.bringer-text-fill-mask:not(.is-init)').each(function() {
                if ( core.sap !== null ) {
                    let $this = jQuery(this);
                    $this.addClass('is-init');
                    core.sap.addTextFillMaskItem( $this, {} );
                }
            })
        }

        // Scroll To Coord
        if (jQuery('[data-scroll-to]').length ) {
            jQuery('[data-scroll-to]').on('click', function(e) {
                e.preventDefault();
                core.scrollToCoord( this.getAttribute('data-scroll-to') );
            });
        }

        // Scroll To Element
        if (jQuery('[data-scroll-to-element]').length ) {
            jQuery('[data-scroll-to-element]').on('click', function(e) {
                e.preventDefault();
                let selector = this.getAttribute('data-scroll-to-element');
                if ( jQuery(selector).length ) {
                    core.scrollToElement( selector );
                }
            });
        }

        // Parallax Media
        if ( jQuery('.bringer-parallax-media:not(.is-init)').length ) {
            jQuery('.bringer-parallax-media:not(.is-init)').each(function() {
                let $this = jQuery(this);
                if ( $this.hasClass('disable-on-t') && window.innerWidth > 739 && window.innerWidth < 1200 ) {
                    return false;
                }
                if ( $this.hasClass('disable-on-tp') && window.innerWidth > 739 && window.innerWidth < 960 ) {
                    return false;
                }
                if ( $this.hasClass('disable-on-m') && window.innerWidth < 739 ) {
                    return false;
                }
                let spd = $this.attr('data-parallax-speed') !== undefined ? parseInt($this.attr('data-parallax-speed'), 10) : 10;
                $this.addClass('is-init');
                $this.find('img').each(function() {
                    core.sap.addParallaxMedia(this, {speed: spd});
                });
                $this.find('video').each(function() {
                    core.sap.addParallaxMedia(this, {speed: spd});
                });
            });
        }
    }

    // --- DATA BACKGROUND --- //
    function DataBackground() {
        if ( jQuery('[data-bg-src]:not(.bg-init)').length ) {
            jQuery('[data-bg-src]:not(.bg-init)').each(function() {
                let $this = jQuery(this);
                $this.addClass('is-init');
                if ( $this.attr('data-bg-type') === undefined || $this.attr('data-bg-type') !== 'video' ) {
                    $this.css('background-image', `url(${$this.attr('data-bg-src')})`);
                } else {

                }
            })
        }
    }

    // --- CONTACT FORM --- //
    function ContactForm() {
        if ( jQuery('.bringer-contact-form').length ) {
            // The code related to the contact form is in the file: js/contact_form.js
            if ( typeof Bringer_Contact_Form === 'function' ) {
                Bringer_Contact_Form();
            } else {
                console.error('Bringer Error: Contact form script not found.')
            }
        }
    }

    // --- INIT ANIMATION --- //
    function InitAnimation() {
        // Change State to Loaded
        core.$dom.body.addClass('is-loaded');

        // Stagger Appear Animation
        if ( jQuery('[data-stagger-appear]').length ) {
            jQuery('[data-stagger-appear]').each(function() {
                let $parent = jQuery(this),
                    delay_step = $parent.attr('data-stagger-delay') !== undefined ? parseInt( $parent.attr('data-stagger-delay'),10 ) : 50,
                    threshold = $parent.attr('data-threshold') !== undefined ? parseFloat( $parent.attr('data-threshold') ) : 0.5,
                    anim_type = $parent.attr('data-stagger-appear'),
                    unload_type = $parent.attr('data-stagger-unload') !== undefined ? $parent.attr('data-stagger-unload') : 'none';
                
                // Calculate Staggered Items
                const calculate_items = function() {
                    let line = 0,
                        prev_line = 0,
                        prev_delay = $parent.attr('data-delay') !== undefined ? parseInt($parent.attr('data-delay'), 10) : 0;
                    
                    $parent.children(':not(.in-view)').each(function(i) {
                        this.classList.add('setting-up');
                        if ( $parent.attr('data-duration') !== undefined ) {
                            this.setAttribute('data-duration', $parent.attr('data-duration'));
                        }
                        if (i === 0) {
                            prev_line = this.getBoundingClientRect().top;
                            this.setAttribute('data-delay', prev_delay);
                        } else {
                            let this_delay = 0;
                            if (this.getBoundingClientRect().top > prev_line) {
                                line++;
                                prev_line = this.getBoundingClientRect().top;
                                prev_delay = 0;
                            }
                            this_delay = prev_delay + delay_step;
                            this.setAttribute('data-delay', this_delay);
                            prev_delay = this_delay;
                        }
                        this.setAttribute('data-appear', anim_type);
                        this.setAttribute('data-unload', unload_type);
                        this.setAttribute('data-threshold', threshold);
                        this.classList.remove('setting-up');
                    });
                }

                // Init Calculation
                calculate_items();

                // Recalculate on Resize
                core.$dom.win.on('resize', function() {
                    calculate_items();
                });
            });
        }

        // Split Text Animation
        if ( jQuery('[data-split-appear]').length ) {
            jQuery('[data-split-appear]').each(function() {
                const text = new SplitType(this);
                const _self = this;
                let anim_type = this.getAttribute('data-split-appear') !== null ? this.getAttribute('data-split-appear') : 'fade-up';
                let unload_type = this.getAttribute('data-split-unload') !== null ? this.getAttribute('data-split-unload') : 'none';
                let duration = this.getAttribute('data-duration') !== null ? parseInt(this.getAttribute('data-duration'),10) : 500;
                let split_by = this.getAttribute('data-split-by') !== null ? this.getAttribute('data-split-by') : 'line';
                let delay = this.getAttribute('data-split-delay') !== null ? parseInt(this.getAttribute('data-split-delay'), 10) : 100;
                let c_delay = this.getAttribute('data-delay') !== null ? parseInt(this.getAttribute('data-delay'), 10) : 0;

                const apply_animation = function() {
                    jQuery(_self).find('.' + split_by).each(function() {
                        if ( this.classList.contains('in-view') ) {
                            this.setAttribute('data-unload', unload_type);
                        } else {
                            this.classList.add('setting-up');
                            this.setAttribute('data-appear', anim_type);
                            this.setAttribute('data-unload', unload_type);
                        }
                        this.setAttribute('data-delay', c_delay);
                        if ( duration !== 500 ) {
                            this.setAttribute('data-duration', duration);
                        }
                        c_delay += delay;
                    });
                }
                apply_animation();

                setTimeout(function() {
                    _self.classList.add('is-done');
                }, (c_delay + delay + duration), _self);
                
                window.addEventListener('resize', () => {
                    text.split();
                    jQuery(_self).find('.' + split_by).addClass('in-view');
                    c_delay = _self.getAttribute('data-delay') !== null ? parseInt(_self.getAttribute('data-delay'), 10) : 0;
                    apply_animation();
                });
            });
        }

        // Single Appear Animation
        setTimeout(function() {    
            if ( jQuery('[data-appear]').length ) {
                jQuery('[data-appear]').each(function() {
                    const _self = this;
                    // Define Threshold
                    this.classList.remove('setting-up');
                    if ( this.getAttribute('data-threshold') !== null ) {
                        this.threshold = this.getAttribute('data-threshold');
                    } else {
                        this.threshold = 0;
                    }
                    // Define Animation Speed
                    if ( this.getAttribute('data-duration') !== null ) {
                        jQuery(this).css('--stea-duration', this.getAttribute('data-duration') + 'ms');
                    }

                    // Animation Function
                    this.stea = function() {
                        // Set Delay
                        let delay = this.getAttribute('data-delay') !== null ? parseInt(this.getAttribute('data-delay'), 10) : 0;

                        // Start Animation after the Delay
                        setTimeout(function() {
                            _self.classList.add('in-view');
                            // Get Animation Duration
                            let td = jQuery(_self).css('transition-duration');
                            let set_d = td.indexOf('ms') > 0 ? parseInt(td, 10) : parseFloat(td) * 1000;
                            // Unobserve
                            core.threshold_observer.unobserve( _self );
                            // Remove Animation Attribute
                            setTimeout(function() {
                                _self.removeAttribute('data-appear');
                            }, set_d, _self);
                        }, delay, _self);
                    }
                    // Register in Observer
                    if ( core.threshold_observer !== null ) {
                        this.intersected = function() {
                            this.stea();
                        }
                        core.threshold_observer.observe(_self);
                    } else {
                        this.stea();
                    }
                });
            }
        }, 400);

        // Page Unloading
        template.checkImageURL = function( url ) {
            return /\.(jpg|jpeg|png|webp|avif|gif|svg)$/.test(url);
        }
        template.checkURL = function( el ) {
            let $el;

            if ( el instanceof jQuery ) {
                $el = el;
            } else {
                $el = jQuery(el);
            }

            let this_href = $el.attr('href'),
                result = true;

            if ( this_href.indexOf('javascript') === 0 ) {
                result = false;
            } else if ( this_href === '#' ) {
                result = false;
            } else if ( $el.attr('target') && '_blank' === $el.attr('target') ) {
                result = false;
            } else if ( this_href.indexOf('elementor-action') > -1 ) {
                result = false;
            } else if ( $el.is('[download]') ) {
                result = false;
            } else if ( this_href.indexOf('tel:') > -1 || this_href.indexOf('mailto:') > -1 ) {
                result = false;
            } else if ( $el.attr('data-elementor-open-lightbox') === 'yes') {
                result = false;
            } else if ( $el.is('#cancel-comment-reply-link') ) {
                result = false;
            } else if ( template.checkImageURL(this_href) ) {
                result = false;
            } else {
                jQuery(bringer_config.linksException).each(function() {
                    if ( $el.is(this) ) {
                        result = false;
                    }
                });
            }

            return result;
        }
        template.unloading = function( new_url = '' ) {
            jQuery('body').addClass('is-unloading');

            const unload_item = function(_this) {
                _this.classList.add('is-unloading');
            }
            const unload_content = function() {
                if ( jQuery('[data-unload]').length ) {
                    jQuery('[data-unload]').each(function() {
                        let _this = this;
                        core.threshold_observer.unobserve( this );
                        if ( this.getAttribute('data-delay') !== null ) {
                            setTimeout(function() {
                                unload_item(_this);
                            }, parseInt(this.getAttribute('data-delay'),10), _this);
                        } else {
                            unload_item(this);
                        }
                    });
                    setTimeout(function() {
                        jQuery('body').removeClass('is-loaded').addClass('is-loading');
                    }, 200);
                } else {
                    jQuery('body').removeClass('is-loaded').addClass('is-loading');
                }
            }
            // Delay for unloading content
            let unload_delay = 0;

            // Unload Header
            if ( core.$dom.header.hasClass('in-view') && core.$dom.header.is('[data-unload]') ) {
                unload_delay = 150;
                core.$dom.header.addClass('is-unloading');
            }
            // Unload Footer
            if ( core.$dom.footer.hasClass('in-view') && core.$dom.footer.is('[data-unload]') ) {
                unload_delay = 150;
                core.$dom.footer.addClass('is-unloading');
            }
            // Unload Content;
            setTimeout(unload_content, unload_delay);

            // Go to URL
            if ( new_url.length ) {
                setTimeout(function() {
                    window.location = new_url;
                }, 500, new_url);
            }
        }

        // Link Click Event
        jQuery(document).on('click', 'a', function(e) {
            if ( this.getAttribute('href').indexOf('#') > -1 && this.getAttribute('href').length > 1 ) {
                if ( this.pathname === window.location.pathname && this.protocol === window.location.protocol && this.host === window.location.host ) {
                    e.preventDefault();
                    if ( core.$dom.body.find( this.hash ).length ) {
                        let origin = 'center';
                        if ( core.$dom.body.find( this.hash ).height() > 0.5 * window.innerHeight ) {
                            origin = 'header';
                        }
                        core.scrollToElement( jQuery( this.hash ), true, origin );
                    }
                }
            } else {
                if ( template.checkURL( this ) ) {
                    e.preventDefault();
                    if ( this.getAttribute('data-unload') !== null ) {
                        this.classList.add('is-unloading');
                    }
                    jQuery(this).parents('[data-unload]').addClass('is-unloading');
                    template.unloading( this.getAttribute('href'));
                }
            }
        });

        // Firefox Back Button Fix
        window.onunload = function(){};

        // Safari Back Button Fix
        jQuery(window).on('pageshow', function(event) {
            if ( jQuery('body').hasClass('is-unloading') ) {
                location.reload();
            }
        });
    }

    // --- LAYOUT --- //
    function Layout() {
        // Classic Menu Position
        core.$dom.nav.find('.bringer-menu-offset').removeClass('bringer-menu-offset');
        core.$dom.nav.find('.sub-menu').each(function(i) {
            var $this = jQuery(this),
                this_left_full = $this.offset().left + $this.width() + parseInt($this.css('padding-left'), 10) + parseInt($this.css('padding-right'), 10);
            if ( this_left_full > (core.$dom.win.width() - 20) ) {
                $this.addClass('bringer-menu-offset');
            }
        });

        // Min Height
        if ( core.$dom.body.hasClass('bringer-fullscreen-page') ) {
            core.$dom.main.addClass('is-fullscreen');
        } else {
            let minHeight = core.sizes.win;
            
            core.$dom.main.removeClass('bringer-min-content');
            core.$dom.footer.removeClass('is-sticky');

            if ( core.$dom.body.hasClass('admin-bar') ) {
                minHeight = minHeight - jQuery('#wpadminbar').height();
            }
            if ( core.$dom.footer.length ) {
                minHeight = minHeight - core.sizes.footer;
            }
            if ( core.$dom.main.height() < minHeight ) {
                core.$dom.main.addClass('bringer-min-content');
                core.$dom.footer.addClass('is-sticky');
            }
        }
    }

    // Init Template
    $(document).ready(function() {
        // General UI
        RightClickProtection( '.bringer-rcp-wrap' );
        MainMenuInit();
        CircleLinks();

        // LightBox
        initPSWP();

        // Hero Sections
        HeroSections();

        // Galleries
        InfiniteList();

        // Elements
        BlocksHighlight();
        SwiperGallery();
        Marquee();
        Counters();
        ListWithPreview();
        BeforeAfter();
        Toggles();
        ScrollTrigger();
        DataBackground();

        // Events
        LinksEvents();

        // Contact Form
        ContactForm();
        
        // Custom Features
        CustomFunction();

        // Loading and Unloading Animation
        setTimeout(function() {
            InitAnimation();
        }, 300);
    });

    // Window Events
    $(window).on('load', function() {
        Layout();
        setTimeout(function() {
            jQuery(window).trigger('resize');
        }, 500);
    }).on('resize', function() {
        Layout();
        setTimeout(function() {
            jQuery(window).trigger('resize');
        }, 100);
    });
});