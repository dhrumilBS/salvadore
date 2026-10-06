/**
 * Author: Shadow Themes
 * Author URL: https://shadow-themes.com
 */
"use strict";

/* --- Class: Before and After --- */
class Bringer_Before_After {
	constructor( $obj = null ) {
        if ( $obj === null ) {
            console.warn('Before After: Item is not specified');
            return false;
        }

        const _self = this;

        // Get Element
        if ($obj instanceof jQuery) {
            this.$el = $obj;
        } else {
            this.$el = jQuery($obj);
        }

        this.$el = {
            $wrap: $obj,
            $before : jQuery('<div class="bringer-before-after-img bringer-before-img"/>').appendTo($obj),
            $after : jQuery('<div class="bringer-before-after-img bringer-after-img-wrap"/>').appendTo($obj),
            $divider : jQuery('<div class="bringer-before-after-divider">\
                <svg xmlns="http://www.w3.org/2000/svg" width="23.813" height="13.875" viewBox="0 0 23.813 13.875">\
                    <path d="M-5.062-15.937l1.125,1.125L-9.047-9.75H9.047L3.938-14.812l1.125-1.125,6.375,6.375L11.906-9l-.469.563L5.063-2.062,3.938-3.187,9.047-8.25H-9.047l5.109,5.063L-5.062-2.062l-6.375-6.375L-11.906-9l.469-.562Z" transform="translate(11.906 15.938)" fill="#fff"/>\
                </svg>\
            </div>').appendTo($obj),
        };
        this.$el.$after.append(_self.$el.$wrap.children('img').clone());
        this.offset = this.$el.$wrap.offset().left;
        this.size = this.$el.$wrap.width();
        this.current = 50;
        this.target = 50;
        this.isDown = false;
        this.isHover = false;

        this.$el.$before.css('background-image', 'url('+ this.$el.$wrap.attr('data-img-before') +')');
        this.$el.$after.children('img').wrap('<div class="bringer-after-img"/>');
        this.$el.$after.children('.bringer-after-img').css('background-image', 'url('+ this.$el.$wrap.attr('data-img-after') +')');

        // Mouse Events
        this.$el.$wrap.on('mousedown', function(e) {
            e.preventDefault();
            _self.isDown = true;
            _self.$el.$wrap.addClass('is-grabbed');
        }).on('mousemove', function(e) {
            e.preventDefault();
            if (_self.isDown) {
                let position = e.pageX - _self.offset,
                    newTarget = position/_self.size;
                if (newTarget > 1) {
                    newTarget = 1;
                }
                if (newTarget < 0) {
                    newTarget = 0;
                }
                _self.target = newTarget * 100;
            }
        }).on('mouseleave', function(e) {
            e.preventDefault();
            _self.isDown = false;
            _self.$el.$wrap.removeClass('is-grabbed');
        }).on('mouseup', function(e) {
            e.preventDefault();
            _self.isDown = false;
            _self.$el.$wrap.removeClass('is-grabbed');
        });

        // Touch Events
        this.$el.$wrap[0].addEventListener('touchstart', function(e) {
            _self.isDown = true;
        }, false);
        this.$el.$wrap[0].addEventListener('touchmove', function(e) {
            let axis = baw_axis.getAxis();
            if ( 'x' === axis ) {
                e.preventDefault();
                if (_self.isDown) {
                    let position = e.touches[0].clientX - _self.offset,
                        newTarget = position/_self.size;
                    if (newTarget > 1) {
                        newTarget = 1;
                    }
                    if (newTarget < 0) {
                        newTarget = 0;
                    }
                    _self.target = newTarget * 100;
                }
            }
        }, false);
        this.$el.$wrap[0].addEventListener('touchend', function(e) {
            _self.isDown = false;
        }, false);

        // Window Events
        jQuery(window).on('resize', function() {
            _self.layout();
            _self.reset();
        }).on('load', function() {
            _self.layout();
        });

        // Layout
        this.layout();

        // Ready
        this.isReady = true;
	}
	layout() {
		this.offset = this.$el.$wrap.offset().left;
		this.size = this.$el.$wrap.width();
		this.$el.$after.children('.bringer-after-img').width( this.$el.$wrap.width() ).height( this.$el.$wrap.height() );
	}
	reset() {
		this.current = 50;
		this.target = 50;
	}
	update() {
		this.current += ((this.target - this.current) * 0.1);
		this.$el.$after.css('width', parseFloat(this.current).toFixed(1) +'%');
		this.$el.$divider.css('left', parseFloat(this.current).toFixed(1) +'%');
	}
}

/* --- Class: Pan Axis Class --- */
class Bringer_PanAxis {
    constructor( sens ) {
        let _self = this;
        this.xs = 0;
        this.xd = 0;
        this.ys = 0;
        this.yd = 0;
        this.ax = 0;
        this.sens = sens;

        document.addEventListener('touchstart', function(e) {
            _self.xs = e.touches[0].clientX;
            _self.ys = e.touches[0].clientY;
        }, false);

        document.addEventListener('touchmove', function(e) {
            if ( ! _self.ax ) {
                // X
                if ( _self.xs ) {
                    _self.xd = _self.xd + Math.abs( _self.xs - e.touches[0].clientX );
                    _self.xs = e.touches[0].clientX;
                }
                if ( _self.ys ) {
                    _self.yd = _self.yd + Math.abs( _self.ys - e.touches[0].clientY );
                    _self.ys = e.touches[0].clientY;
                }

                // Check Axis
                if (_self.xd > _self.sens) {
                    _self.ax = 'x';
				}
                if (_self.yd > _self.sens) {
                    _self.ax = 'y';
				}
            }
        }, false);

        document.addEventListener('touchend', function(e) {
            // Reset Values
            _self.xs = 0;
            _self.xd = 0;
            _self.ys = 0;
            _self.yd = 0;
            _self.ax = 0;
        }, false);
    }
    getAxis() {
        return this.ax;
    }
}
const baw_axis = new Bringer_PanAxis( 10 );

/* --- Class: Main Menu --- */
class Bringer_Menu {
    constructor( _core = null ) {
        const _self = this;
        
        if ( _core === null ) {
            console.warn('Menu Core not specified');
            return false;
        }

        this.core = _core;
        this.$nav = _core.$dom.nav;
        this.$main = this.$nav.children('ul.main-menu');

        if ( ! this.$main.children().length ) {
            console.warn('Main Menu is empty');
            return false;
        }

        // Main Menu Active Indicator
        this.core.$dom.header.append('<span class="bringer-active-menu-ind"></span>');

        // Add "has-children"
        this.$main.find('li').each(function() {
            if ( jQuery(this).children('ul').length && !this.classList.contains('menu-item-has-children') ) {
                this.classList.add('menu-item-has-children');
            }
        });

        // Events
        _core.$dom.win
            .on('resize', function() {
                _self.layout();
                setTimeout(_self.layout(),100);
            })
            .on('load', this.layout());

        // Create Mobile Menu
        this.mobile_menu = new Bringer_Mobile_Menu( this.$nav );
    }
    layout() {
        const _self = this;
        let active_pos = '-100%';
        let active_width = '0px';
        if ( this.$main.children('.current-menu-ancestor').length ) {
            active_pos = this.$main.children('.current-menu-ancestor').offset().left;
            active_width = this.$main.children('.current-menu-ancestor').width();
            if ( this.$main.children('.current-menu-ancestor').hasClass('menu-item-has-children') ) {
                active_width -= 20;
            }
        }
        if ( this.$main.children('.current-menu-parent').length ) {
            active_pos = this.$main.children('.current-menu-parent').offset().left;
            active_width = this.$main.children('.current-menu-parent').width();
            if ( this.$main.children('.current-menu-parent').hasClass('menu-item-has-children') ) {
                active_width -= 20;
            }
        }
        if ( this.$main.children('.current-menu-item').length ) {
            active_pos = this.$main.children('.current-menu-item').offset().left;
            active_width = this.$main.children('.current-menu-item').width();
        }
        active_pos = Math.round(active_pos);
        active_width = Math.round(active_width);
        this.core.$dom.header.css({
            '--active-left': `${active_pos}px`,
            '--active-width': `${active_width}px`
        });
    }
}

/* --- Class: Mobile Menu --- */
class Bringer_Mobile_Menu {
    constructor( $obj )  {
        const _self = this;
        
        if ($obj instanceof jQuery) {
            this.$el = $obj;
        } else {
            this.$el = jQuery($obj);
        }

        if ( ! this.$el.length || ! this.$el.children().length || ! this.$el.children('ul').children().length ) {
            console.warn('Menu Error: Menu not found or is empty.')
            return false;
        }
        this.$body = jQuery('body');
        this.$nav = jQuery('<nav class="bringer-mobile-nav"/>').appendTo(this.$body);
        if ( this.$el.parents('header').hasClass('is-frosted') ) {
            this.$nav.addClass('is-frosted');
        }
        this.$menu = jQuery('<ul class="bringer-mobile-menu"/>').appendTo(this.$nav);
        this.$el.children('ul').children().each(function() {
            jQuery(this).clone().appendTo(_self.$menu);
        });
        this.$overlay = jQuery('<div class="bringer-mobile-menu-overlay"/>').appendTo(this.$body);
        this.$menu.find('a[href="#"]').each(function() {
            this.setAttribute('href', 'javascript:void(0)');
            this.addEventListener('click', (e) => {
                e.preventDefault();
                this.classList.toggle('is-active');
                jQuery(this).parent('li').children('ul').slideToggle(300);
            });
        });

        // Events
        jQuery('.bringer-mobile-menu-toggler').on('click', function() {
            _self.$body.toggleClass('show-menu');
        });
        this.$overlay.on('click', function() {
            _self.$body.removeClass('show-menu');
        });
    }
}

/* --- Class: Infinite List --- */
class Bringer_Infinite_List {
    constructor( $obj = null, cfg = {} )  {
        if ( $obj === null ) {
            return false;
        }
        const _self = this;
        
        if ($obj instanceof jQuery) {
            this.$el = $obj;
        } else {
            this.$el = jQuery($obj);
        }
        this.cfg = Object.assign({
            touchSpeed: 0.05,
            dragSpeed: 0.05
        }, cfg);
        this.isTouchDevice = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0));
        this.init();

        // Scroll Event
        document.addEventListener('wheel', function(e) {
            let scroll_path = (e.deltaY * 0.25  / window.innerHeight) * 100;
            _self.pos.target -= scroll_path;
        });
        // Touch Event
        if ( this.cfg.touchSpeed > 0 ) {
            // Touch Events
            this.$el.on('touchstart', function(e) {
                _self.moveStart(e);
            });
            this.$el.on('touchmove', function(e) {
                if ( baw_axis.getAxis() === 'y' ) {
                    _self.moveDrag(e);
                }
            });
            this.$el.on('touchend', function() {
                _self.moveEnd();
            });
        }
        // Mouse Drag Event
        if ( this.cfg.dragSpeed > 0 ) {
            this.$el.on('mousedown', function(e) {
                _self.moveStart(e);
            });
            this.$el.on('mousemove', function(e) {
                _self.moveDrag(e);
            });
            this.$el.on('mouseup', function(e) {
                _self.moveEnd();
            });
            this.$el.on('mouseleave', function(e) {
                _self.moveEnd();
            });
        }
        // Hover Event
        this.$el.on('mouseenter', '.bringer-infinite-list-item', function() {
            _self.$el.addClass('is-hovererd');
            let $preview = _self.$bg_wrap.children('[data-id="'+ this.getAttribute('data-id') +'"]');
            _self.$bg_wrap.children('.is-active').removeClass('is-active');
            $preview.addClass('is-active');
            if ('video' === $preview.attr('data-type') ) {
                jQuery(this).children('.bringer-infinite-list-preview').children('video')[0].play();
                $preview.children('video')[0].play();
            }
        }).on('mouseleave', '.bringer-infinite-list-item', function() {
            _self.$el.removeClass('is-hovererd');
            let $preview = _self.$bg_wrap.children('[data-id="'+ this.getAttribute('data-id') +'"]');
            //$preview.removeClass('is-active');
            if ('video' === $preview.attr('data-type') ) {
                jQuery(this).children('.bringer-infinite-list-preview').children('video')[0].pause();
                $preview.children('video')[0].pause();
            }
        });
        // Prevent Links from opening while Drag
		this.$el.on('click', 'a', function(e) {
			if ( _self.linkMove ) {
				e.preventDefault();
				return false;
			}
			_self.linkMove = false;
			_self.linkDown = false;
		});
        // Window Event
        jQuery(window).on('resize', function() {
            if ( this.isTouchDevice ) {
                _self.play_pause_video();
            }
        }).on('orientationchange', function() {
            if ( this.isTouchDevice ) {
                _self.play_pause_video();
            }
        });
        this.play_pause_video();
    }
    play_pause_video() {
        if ( this.isTouchDevice ) {
            this.$el.find('video').each(function(){
                this.play();
            });
        } else {
            this.$el.find('video').each(function(){
                this.pause();
            });
        }
    }
    init() {
        const _self = this;
        
        // SIZES
        this.sizes = {
            win: jQuery(window).height(),
        }
        this.pos = {
            target: 0,
            current: 0
        };

        // VARIABLES
        this.linkDown = false;
		this.linkMove = false;
        this.isTouched = false;
		this.isDragged = false;
		this.isHover = false;
        this.touchPoint = 0;

        // DOM
        this.$list = this.$el.children('.bringer-infinite-list');
        this.$bg_wrap = jQuery('<div class="bringer-infinite-list-bgs"/>').appendTo(this.$el);
        this.$scroll = jQuery('<div class="bringer-infinite-scroll"/>').appendTo(this.$el);
        this.$cloned_list = jQuery('<div class="bringer-infinite-scroll-inner"/>').appendTo(this.$scroll);
        this.first_circle = true;
        this.clone_items();

        // Ready Flag
        this.isReady = true;
    }
    clone_items() {
        const _self = this;
        this.$list.children().each(function(i) {
            let $cloned = jQuery(this).clone();
            $cloned.attr('data-id', i);
            _self.$cloned_list.append($cloned);
            if ( _self.first_circle ) {
                let $preview = $cloned.children('.bringer-infinite-list-preview');
                let type = $preview.children('video').length ? 'video' : 'img';
                let this_src = $preview.children(type).attr('src');
                if ( 'video' === type ) {
                    let $video = $preview.children('video');
                    if ( $video.attr('playsinline') === undefined ) {
                        $video.attr('playsinline', '');
                    }
                    if ( $video.attr('muted') === undefined ) {
                        $video.attr('muted');
                    }
                    if ( $video.attr('loop') === undefined ) {
                        $video.attr('loop', 'true');
                    }
                    _self.$bg_wrap.append(`
                    <div class="bringerl-bg-preview-item${(i === 0 ? ' is-active':'')}" data-type="video" data-id="${i}" style="background-image:url(${this_src})">
                        <video src="${this_src}" webkit-playsinline="true" playsinline="true" muted loop></video>
                    </div>`);
                } else {
                    $preview.css('background-image', 'url('+ this_src + ')');
                    _self.$bg_wrap.append(`<div class="bringerl-bg-preview-item${(i === 0 ? ' is-active':'')}" data-type="image" data-id="${i}" style="background-image:url(${this_src})"/>`);
                }
            }
        });
        this.first_circle = false;
        if ( this.$cloned_list.height() < this.$el.height() ) {
            this.clone_items();
        } else {
            this.$scroll.append(this.$cloned_list.clone());
        }
    }
    moveStart(e) {
        this.linkMove = false;
        if ( jQuery(e.target).is('a') ) {
            this.linkDown = true;
        }
        this.isTouched = 1;
        if ( e.touches ) {
            this.touchPoint = e.touches[0].clientY;
        } else {
            this.touchPoint = e.clientY;
            this.$el.addClass('is-grabbed');
        }
    }
    moveDrag(e) {
        e.preventDefault();
        if ( this.isTouched ) {
            let path;
    
            if ( e.touches ) {
                path = (this.touchPoint - e.touches[0].clientY) * this.cfg.touchSpeed;
                this.touchPoint = e.touches[0].clientY;
            } else {
                path = (this.touchPoint - e.clientY) * this.cfg.dragSpeed;
                this.touchPoint = e.clientY;
            }
            this.pos.target -= path;

            // Link Protection
            if (this.linkDown) {
                this.linkMove = true;
            } else {
                this.linkMove = false;
            }
        }
    }
    moveEnd() {
        this.touchPoint = 0;
        this.isTouched = 0;
        this.$el.removeClass('is-grabbed');
        this.linkDown = false;
    }
    update( time = {delta: 0, elapsed: 0} ) {
        this.pos.current += (this.pos.target - this.pos.current) * 0.1;
        if ( this.pos.current < -50 ) {
            let diff = this.pos.target - this.pos.current;
            this.pos.current = 0;
            this.pos.target = diff;
        }
        if (this.pos.current > 0) {
            let diff = this.pos.target - this.pos.current;
            this.pos.current = -50;
            this.pos.target = -1 * (50 - diff);
        }
        this.$scroll.css('transform', 'translateY('+ this.pos.current +'%)');
    }
}

/* --- Class: Animated Marquee --- */
class Bringer_Marquee {
    constructor( $obj = null )  {
        if ( $obj === null ) {
            return false;
        }
        const _self = this;
        
        if ($obj instanceof jQuery) {
            this.$marquee = $obj;
        } else {
            this.$marquee = jQuery($obj);
        }

        this.init_speed = this.$marquee.attr('data-type') !== undefined ? parseInt(this.$marquee.attr('data-speed'), 10) : 5000;
        this.speed = this.init_speed;
        
        this.$inner = this.$marquee.children('.bringer-marquee-inner');
        this.$content = this.$inner.children();
        this.width = this.$inner.find('.bringer-marquee-list').width();

        if ( this.$inner.width() < this.$marquee.width() ) {
            this.duplicate();
        } else {
            this.init();
        }
    }
    init() {
        this.$inner.wrapInner('<div class="bringer-marquee-inner-wrap"/>');
        this.$inner_cont = this.$inner.children('.bringer-marquee-inner-wrap');
        this.$inner.append( this.$inner_cont.clone() );
        this.start();
    }
    start() {
        // Calculate speed
        this.speed = 0.5 * this.$inner.width() * (this.init_speed/this.width);
        this.$inner.css('animation-duration', this.speed + 'ms');

        // Init Animation
        this.$marquee.addClass('is-init');
    }
    duplicate() {
        this.$inner.append( this.$content.clone() );
        if ( this.$inner.width() < this.$marquee.width() ) {
            this.duplicate();
        } else {
            this.init();
        }
    }
}

/* --- Class: Masked Block --- */
class Bringer_Masked {
    constructor( $obj = null, cfg = {} ) {
        if ( $obj === null ) {
            console.warn('Masked Shape: Item is not specified');
            return false;
        }

        const _self = this;

        // Get Element
        if ($obj instanceof jQuery) {
            this.$el = $obj;
        } else {
            this.$el = jQuery($obj);
        }

        // Options
        this.cfg = Object.assign({
            media_selector: '.bringer-masked-media',
            content_selector: '.bringer-masked-content',
            dbr: 24,
            ibr: 32
        }, cfg);

        // Define DOM
        this.$media = this.$el.find(this.cfg.media_selector).length ? this.$el.find(this.cfg.media_selector) : false;
        this.$content = this.$el.find(this.cfg.content_selector).length ? this.$el.find(this.cfg.content_selector) : false;

        if ( this.$content === false ) {
            console.warn('Masked Shape: Content is not specified');
            return false;
        }
        if ( this.$media === false ) {
            console.warn('Masked Shape: Media is not specified');
            return false;
        }
        this.id = 'mask_' + Math.random().toString(36).substr(2, 9);

        // Get Path
        this.path = this.get_path();
        this.$mask = jQuery(`
        <svg width="0" height="0">
            <defs>
                <clipPath id="${this.id}">
                    <path d="${this.path} Z"/>
                </clipPath>
            </defs>
        </svg>`);
        this.$mask.css({
            'position': 'absolute',
            'left': 0,
            'top': 0,
            'pointer-events': 'none',
            'opacity': 0
        });
        this.$path = this.$mask.children('defs').children('clipPath').children('path');
        this.$el.append(this.$mask);
        this.$media.css('clip-path', `url(#${this.id})`);

        // Events
        jQuery(window).on('resize', function() {
            _self.layout();
            setTimeout(function() {
                _self.layout();
            },10, _self);
        }).on('load', function() {
            _self.layout();
        });
    }
    get_path() {
        let path = ``,
            cw = this.$content.width(),
            ch = this.$content.height(),
            tw = this.$el.width(),
            th = this.$el.height(),
            br = parseInt((this.$el.css('--masked-border-radius') !== undefined ? this.$el.css('--masked-border-radius') : this.cfg.dbr), 10),
            ibr = parseInt((this.$el.css('--masked-inner-radius') !== undefined ? this.$el.css('--masked-inner-radius') : br), 10),
            d_rect = {},
            pos = '';
        
        // Get Postion
        if ( this.$content.css('position') !== 'absolute' || cw === 0 || ch === 0 ) {
            pos = 'default';
        } else {
            let t_rect = this.$el[0].getBoundingClientRect(),
                c_rect = this.$content[0].getBoundingClientRect();
            d_rect.top = Math.round(c_rect.top - t_rect.top);
            d_rect.bottom = Math.round(t_rect.bottom - c_rect.bottom);
            d_rect.left = Math.round(c_rect.left - t_rect.left);
            d_rect.right = Math.round(t_rect.right - c_rect.right);

            if ( d_rect.top === 0 || d_rect.bottom === 0 ) {
                pos = (parseInt(this.$content.css('bottom'), 10) === 0 ? 'b' : 't');
            } else {
                pos = 'v';
            }
            if ( d_rect.left === 0 || d_rect.right === 0 ) {
                pos += (parseInt(this.$content.css('right'), 10) === 0 ? 'r' : 'l');
            } else {
                pos += 'h';
            }
        }           
         
        // Mask Path
        switch (pos) {
            // Top Right
            case 'tr':
                path += `
                M0,${br}
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw - cw - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${(tw - cw)},${(ch - ibr)} 
                a${ibr},${ibr} 0 0 0 ${ibr},${ibr} 
                L${(tw - br)},${ch} 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${(th - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
            // Bottom Right
            case 'br':
                path += `
                M0,${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${(th - ch - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${(tw - cw + ibr)},${(th-ch)} 
                a${ibr},${ibr} 0 0 0 -${ibr},${ibr} 
                L${(tw - cw)},${(th - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
            // Bottom Left
            case 'bl':
                path += `
                M0,${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${(th - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${cw+br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                L${cw},${(th - ch + ibr)} 
                a${ibr},${ibr} 0 0 0 -${ibr},-${ibr} 
                L${br},${(th - ch)} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
            // Top Left
            case 'tl':
                path += `
                M0,${(ch+br)} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${cw-ibr},${ch} 
                a${ibr},${ibr} 0 0 0 ${ibr},-${ibr} 
                L${(cw)},${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${(th - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
            // Bottom Edge
            case 'bh': 
                path += `
                M0,${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${th-br} 
                a${br},${br} 0 0 1 ${-br},${br} 
                L${(tw - d_rect.right + br)},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                L${(tw - d_rect.right)},${d_rect.top + ibr} 
                a${ibr},${ibr} 0 0 0 -${ibr},${-ibr} 
                L${d_rect.left+ibr},${d_rect.top} 
                a${ibr},${ibr} 0 0 0 -${ibr},${ibr} 
                L${d_rect.left}, ${(th - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L0,${th} 
                `;
            break;
            // Top Edge
            case 'th': 
                path += `
                M0,${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(d_rect.left - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${d_rect.left},${(ch - ibr)} 
                a${ibr},${ibr} 0 0 0 ${ibr},${ibr} 
                L${d_rect.left + cw - ibr},${ch} 
                a${ibr},${ibr} 0 0 0 ${ibr},${-ibr} 
                L${d_rect.left + cw},${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${th - br} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
            // Left Edge
            case 'vl': 
                path += `
                M0,${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw-br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${(th-br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                L0,${th - d_rect.bottom + br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${cw - ibr},${th - d_rect.bottom} 
                a${ibr},${ibr} 0 0 0 ${ibr},${-ibr} 
                L${cw},${d_rect.top + ibr} 
                a${ibr},${ibr} 0 0 0 ${-ibr},${-ibr} 
                L${br},${d_rect.top} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
            // Right Edge
            case 'vr': 
                path += `
                M0,${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw-br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${(d_rect.top - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${(tw - cw + ibr)},${d_rect.top} 
                a${br},${br} 0 0 0 -${ibr},${ibr} 
                L${(tw - cw)},${d_rect.top + ch - ibr} 
                a${br},${br} 0 0 0 ${ibr},${ibr} 
                L${(tw - br)},${(d_rect.top + ch)} 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${th - br} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
            // Default (no content area)
            default:
                path += `
                M0,${br} 
                a${br},${br} 0 0 1 ${br},-${br} 
                L${(tw - br)},0 
                a${br},${br} 0 0 1 ${br},${br} 
                L${tw},${(th - br)} 
                a${br},${br} 0 0 1 -${br},${br} 
                L${br},${th} 
                a${br},${br} 0 0 1 -${br},-${br} 
                `;
            break;
        }
        path += `Z`;

        return path;
    }
    layout() {
        this.path = this.get_path();
        this.$path.attr('d', this.path);
    }
}

class Bringer_LWP {
    constructor( $obj = null )  {
        if ( $obj === null ) {
            return false;
        }
        const _self = this;
        
        if ($obj instanceof jQuery) {
            this.$el = $obj;
        } else {
            this.$el = jQuery($obj);
        }

        this.$list = this.$el.children();
        this.$media = jQuery('<div class="bringer-lwp-media" data-appear="fade-right"/>').prependTo(this.$el);
        this.count = this.$list.children('.bringer-lwp-item').length;
        this.active = 0;
        this.prev = 1;

        this.$list.children('.bringer-lwp-item').each(function(i) {
            let $item = jQuery(this),
                $img = $item.children('img').clone(),
                idx = _self.count - i;
            
            $img.appendTo(_self.$media);
            $img.css({
                'transform': `translateX(-${(100 * i)}%)`,
                'z-index': idx
            });

            if (i === 0) {
                $item.addClass('is-active').addClass('is-accented');
                $img.addClass('is-active');
            }

            $item.on('mouseenter', function() {
                if ( i !== _self.active ) {
                    _self.prev = _self.active;
                    _self.active = i;
                    _self.setItem();
                }
            });
        });
    }
    setItem () {
        this.$media.children().css('z-index', 0).removeClass('is-active');
        this.$media.children().eq(this.prev).css('z-index', this.count).addClass('is-prev');
        this.$media.children().eq(this.active).css('z-index', this.count + 1).addClass('is-active');
        
        this.$list.children().removeClass('is-active').removeClass('is-accented');
        this.$list.children().eq(this.active).addClass('is-active').addClass('is-accented');
    }
}