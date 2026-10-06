/**
 * Author: Shadow Themes
 * Author URL: https://shadow-themes.com
 */
"use strict";
const PREFIX = 'bringer';

class ST_Core {
    constructor( o = {} )  {
        const _self = this;

        // Specify Options
        this.cfg = Object.assign({
            // Main Logo Size
            logo_size: {
                w: 88,
                h: 24
            },
            // Interractive Cursor
            iCursor: {
                state: false,
                cursorHover: '.not-specified-class',
                cursorscrollEW: '.not-specified-class',
                cursorscrollNS: '.not-specified-class',
                cursorFollow: '.not-specified-class',
            },
            cursorFollow: null,
            // DOM Elements
            elements: {
                header: 'header#' + PREFIX + '-header',
                nav: 'nav.' + PREFIX + '-nav',
                footer: 'footer#' + PREFIX + '-footer',
                main: 'main#' + PREFIX + '-main',
            },
            // Links Exception
            linksException: [],
            // Drag Protection
            dragProtection: true,
            // Smooth Scroll
            smoothScroll: false
        }, o);

        // Detect Environment
        this.isTouchDevice = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0));
        this.iOSDevice = !!navigator.platform.match(/iPhone|iPod|iPad/);
        this.isFirefox = (navigator.userAgent.indexOf("Firefox") > -1) ? true : false;
        this.isChrome = (navigator.userAgent.indexOf("Chrome") > -1) ? true : false;
        this.template = null;
        this.updateRequired = [];

        // Define Elements
        this.$dom = {
            document: jQuery(document),
            body: jQuery('body'),
            win: jQuery(window),
        }
        for (const [key, value] of Object.entries(this.cfg.elements)) {
            this.$dom[key] = jQuery(value);
        }
        this.cfg.header = {
            is_sticky: this.$dom.header.hasClass('is-sticky') ? true : false,
            hide_on_scroll: this.$dom.header.hasClass('hide-on-scroll') ? true : false,
        }

        // Elements Sizes
        this.sizes = {
            header: this.$dom.header.height(),
            footer: this.$dom.footer.height(),
            body: this.$dom.body.height(), 
            scrollbar: window.innerWidth - this.$dom.win.width(),
            win: this.$dom.win.height()
        }

        // CSS Variables
        this.$dom.body.css({
            '--st-header-height': this.sizes.header + 'px',
            '--st-header-percent-height': parseFloat(this.sizes.header/this.sizes.win * 100).toFixed(2) + '%',
            '--st-footer-height': this.sizes.footer + 'px',
            '--st-footer-percent-height': parseFloat(this.sizes.footer/this.sizes.win * 100).toFixed(2) + '%',
            '--st-scrollbar-size': this.sizes.scrollbar + 'px',
        });

        // Utils and Helpers
        this.utils = new ST_Utils();

        // Animation Stuff
        if ( typeof THREE === 'object' ) {
            this.clock = new THREE.Clock();
        } else {
            this.clock = new ST_Clock();
        }
        this.prevTime = 0;
        this.anim_loop = requestAnimationFrame( () =>  this.ticker() );

        // Global Observer
        if ('IntersectionObserver' in window) {
            // Regular Observer
            this.observer = new IntersectionObserver((entries) => {
    			entries.forEach((entry) => {
    				if ( ! entry.isIntersecting ) {
                        if ( entry.target.hasOwnProperty('notInView') ) {
                            entry.target.notInView();
                        }
    					return;
    				} else {
                        if ( entry.target.hasOwnProperty('intersected') ) {
                            entry.target.intersected();
                        }
    				}
    			});
    		});
            // Threshold Observer
            this.threshold_observer = new IntersectionObserver((entries) => {
    			entries.forEach((entry) => {
    				if ( ! entry.isIntersecting ) {
                        if ( entry.target.hasOwnProperty('notInView') ) {
                            entry.target.notInView();
                        }
    					return;
    				} else {
                        if ( entry.target.threshold !== undefined ) {
                            if ( entry.intersectionRatio >= entry.target.threshold ) {
                                if ( entry.target.hasOwnProperty('intersected') ) {
                                    entry.target.intersected();
                                }    
                            }
                        } else {
                            if ( entry.target.hasOwnProperty('intersected') ) {
                                entry.target.intersected();
                            }
                        }
    				}
    			});
    		},
            {
                threshold: [0, 0.25, 0.5, 0.75, 1.0]
            });
        } else {
            this.observer = null;
            this.threshold_observer = null;
        }

        // Lazy Loading
        if ( jQuery('.' + PREFIX + '-lazy').length ) {
            jQuery( '.' + PREFIX + '-lazy').each(function(i) {
                _self.lazyLoader(this);
            });
        }

        // Start Initialization
        this.init();

        // Events
        this.$dom.win.on('load', function() {
            _self.layout();
        }).on('resize', function() {
            _self.layout();
        })
        this.$dom.document.on('click', 'a[href="#"]', function(e) {
            e.preventDefault();
        });
    }

    // --- Init --- //
    init() {
        const _self = this;
        
        // Image Drag Protection
        if ( this.dragProtection ) {
            this.$dom.document.on('mousedown', 'a', function (e) {
                if ( jQuery(this).attr('href').indexOf('.png') || jQuery(this).attr('href').indexOf('.gif') || jQuery(this).attr('href').indexOf('.jpg') ) {
                    e.preventDefault();
                }
            });
            this.$dom.document.on('mousedown', 'img', function (e) {
                e.preventDefault();
            });
        }

        // Retina Logo
        if ( jQuery('.'+ PREFIX +'-logo.is-retina').length ) {
            jQuery('.'+ PREFIX +'-logo.is-retina').each(function() {
                let $this = jQuery(this);
                $this.css({
                    'width' : $this.children('img').attr('width') ? (0.5 * $this.children('img').attr('width')) : _self.cfg.logo_size.w,
                    'height' : $this.children('img').attr('height') ? (0.5 * $this.children('img').attr('height')) : _self.cfg.logo_size.h,
                });
            });
        }

        // Smooth Scroll
        if ( this.cfg.smoothScroll && ! this.isTouchDevice && ! this.$dom.body.hasClass( 'disable-smooth-scroll' ) ) {
            this.scroll = new ST_Smooth_Scroll( this.$dom.main, this );
        } else {
            this.scroll = null;
        }

        // Scroll Animation Platform
        this.sap = new ST_SAP( this );

        // Interactive Cursor
        if ( this.cfg.iCursor.state ) {
            this.iCursor = new ST_iCursor( this );
        } else {
            this.iCursor = null;
        }
    
        // Cursor Following
        if ( this.cfg.cursorFollow !== null && this.cfg.cursorFollow.length )  {
            jQuery(document).on('mousemove', this.cfg.cursorFollow, function(e) {
                if ( ! _self.isTouchDevice ) {
                    let dim = this.getBoundingClientRect(),
                        x = e.clientX - dim.x - 0.5 * dim.width,
                        y = e.clientY - dim.y - 0.5 * dim.height;
                    jQuery(this).css('transform', 'translate(' + (x * 0.33) + 'px, '+ (y * 0.33) +'px) scale(1.1)');
                    jQuery(this).on('mouseleave', function() {
                        jQuery(this).removeAttr("style");
                    });
                }
            });
        }

        // General Events
        this.$dom.win.on('resize', function() {
            _self.layout();
        }).on('load', function() {
            _self.layout();
        }).on('scroll', function() {
            // Scrolled Header Class
            if ( window.scrollY > _self.sizes.header ) {
                _self.$dom.header.addClass('is-scrolled');
            } else {
                _self.$dom.header.removeClass('is-scrolled');
            }
        }).on('scrollResize', function() {
            _self.layout();
        });
    }

    // --- Main Animation Loop --- //
    ticker(t) {
        this.anim_loop = requestAnimationFrame( () =>  this.ticker() );

        // Update Timer
        const elapsedTime = this.clock.getElapsedTime();
        const deltaTime = elapsedTime - this.prevTime; // Frame Speed
        this.prevTime = elapsedTime;
        const this_time = {
            delta: deltaTime,
            elapsed: elapsedTime
        }

        // Update Smooth Scroll
        if ( this.scroll !== null && this.scroll.isReady ) {
            this.scroll.updateScroll(deltaTime);
        }

        // Update Required Objects
        if ( this.updateRequired.length ) {
            this.updateRequired.forEach( (item) => {
                if ( item.isReady ) {
                    item.update(this_time);
                }
            });
        }

        // Update SAP
        if ( this.sap !== null ) {
            let cs = this.scroll !== null ? -1 * this.scroll.pos.c : window.scrollY;
            this.sap.update( this_time, cs);
        }

        // iCursor
        if ( this.iCursor !== null ) {
            this.iCursor.update(deltaTime);
        }
    }

    // --- Lazy Loader --- //
    lazyLoader( item ) {
        const _self = this;
        let $this = jQuery(item);
        if ( $this.attr('data-src') === undefined ) {
            console.warn('Lazy Loader: data-src attribute is not specified for', i);
            return false;
        }
        // Check for Observer
        if ( _self.observer !== null ) {
            $this.wrap('<div class="st-lazy-wrapper"/>').removeClass(PREFIX + '-lazy');
            if ( ! $this.attr('class').length ) {
                $this.removeAttr('class');
            }
            if ( $this.attr('width') !== undefined && $this.attr('height') !== undefined ) {
                $this.attr('src', `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${$this.attr('width')} ${$this.attr('height')}' width='${$this.attr('width')}' height='${$this.attr('height')}'></svg>`);
            }

            // Loading Function
            item.intersected = function() {
                const src = this.getAttribute('data-src');
                const _this = this;
                let img = new Image();
                img.src = src;
                img.addEventListener('load', function(e) {
                    _this.src = src;
                    jQuery(_this).parent('.st-lazy-wrapper').addClass('is-loaded').removeAttr('style');
                    setTimeout(function() {
                        jQuery(_this).parent('.st-lazy-wrapper').addClass('stop-anim');
                    }, 300, _this);
                    jQuery(window).trigger('ST_LIL');

                    // Remove From Observer
                    _self.observer.unobserve( _this );
                });
            }

            // Add Item to Observer
            _self.observer.observe(item);
        } else {
            // No Observer, append SRC
            $this.attr('src', $this.attr('data-src'));
        }
    }

    // --- Layout Calculation --- //
    layout() {
        const _self = this;
        // Elements Sizes
        this.sizes = {
            header: this.$dom.header.height(),
            footer: this.$dom.footer.height(),
            win: this.$dom.win.height()
        }

        // CSS Variables
        this.$dom.body.css({
            '--st-header-height': this.sizes.header + 'px',
            '--st-header-percent-height': parseFloat(this.sizes.header/this.sizes.win * 100).toFixed(2) + '%',
            '--st-footer-height': this.sizes.footer + 'px'
        });
        if ( this.sap !== null ) {
            this.sap.layout();
            setTimeout(function() {
                _self.sap.layout();
            }, 500, _self);
        }
        if ( this.scroll !== null ) {
            this.scroll.layout();
        }
    }

    // --- Get Current Scroll Position --- //
    getCurrentScroll() {
        if ( this.scroll !== null ) {
            return this.scroll.pos.c;
        } else {
            return window.scrollY;
        }
    }
    getFinalScroll() {
        if ( this.scroll !== null ) {
            return this.scroll.pos.t;
        } else {
            return window.scrollY;
        }
    }
    scrollToCoord( coord = 0, animate = true ) {
        let scrollTo = coord;
        if ( typeof coord !== 'number' ) {
            if ( coord.indexOf('%') > 0 || coord.indexOf('vh') > 0 ) {
                scrollTo = parseFloat(coord) * 0.01 * this.sizes.win;
            } else if ( coord <= 1 ) {
                scrollTo = parseFloat(coord) * this.sizes.win;
            } else {
                scrollTo = parseInt(coord, 10);
            }
        }
        if ( this.scroll !== null ) {
            window.scrollTo({ top: scrollTo });
            jQuery('html, body').stop().scrollTop(scrollTo);
        } else {
            window.scrollTo({ 
                top: scrollTo, 
                behavior: animate ? 'smooth' : 'instant'
            });
        }
    }
    scrollToElement( elem = null, animate = true, origin = 'center' ) {
        if ( elem !== null ) {
            const $elem = elem instanceof jQuery ? elem : jQuery(elem);
            let offset = 0;
            if ( $elem.length ) {
                switch (origin) {
                    case 'top':
                        offset = 0;
                        break;
                    case 'header':
                        offset = this.sizes.header;
                        break;
                    case 'center':
                        offset = 0.5 * this.sizes.win - 0.5 * $elem.height(); //center
                        break;
                    case 'bottom':
                        offset = this.sizes.win - $elem.height();
                        break;
                    default:
                        let parsed = parseFloat(origin);
                        offset = this.sizes.win * (parsed <= 1 ? parsed : parsed * 0.01);
                        break;
                }
                let position = $elem.offset().top - offset;
                if ( this.scroll !== null ) {
                    position -= this.getCurrentScroll();
                }
                this.scrollToCoord(position, animate)
            }
        } else {
            return false;
        }
    }
}

// Timer Class
class ST_Clock {
	constructor(autoStart = true) {
		this.autoStart = autoStart;
		this.startTime = 0;
		this.oldTime = 0;
		this.elapsedTime = 0;
		this.running = false;
	}

	start() {
		this.startTime = this.now();
		this.oldTime = this.startTime;
		this.elapsedTime = 0;
		this.running = true;
	}

	stop() {
		this.getElapsedTime();
		this.running = false;
		this.autoStart = false;
	}

	getElapsedTime() {
		this.getDelta();
		return this.elapsedTime;
	}

	getDelta() {
		let diff = 0;

		if (this.autoStart && !this.running) {
			this.start();
			return 0;
		}

		if (this.running) {
			const newTime = this.now();
			diff = (newTime - this.oldTime) / 1000;
			this.oldTime = newTime;
			this.elapsedTime += diff;
		}

		return diff;
	}

    now() {
		return (typeof performance === 'undefined' ? Date : performance).now()
    }
}

// Utils Class
class ST_Utils {
    constructor()  {
        const _self = this;
    }
    generateID() {
        return '_' + Math.random().toString(36).substr(2, 9);
    }
    getID( item ) {
        let $item;
        if (item instanceof jQuery) {
            $item = item;
        } else {
            $item = jQuery(item);
        }
        if ( $item.attr('data-id') !== undefined && $item.attr('data-id').length ) {
            return $item.attr('data-id');
        } else {
            let newID = this.generateID();
            $item.attr('data-id', newID);
            return newID;
        }
    }
}

// Smooth Scroll Class
class ST_Smooth_Scroll {
	constructor( $obj = null, core = null, options = {} )  {
        const _self = this;

        if ( $obj === null ) {
            console.warn('Smooth Scroll: Item is not specified');
            return false;
        }
        if ( core === null ) {
            console.warn('Smooth Scroll: Core is not specified');
            return false;
        }

        this.core = core;

        // Terminate Smooth Scroll if Touch device is detected
        if ( ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0) ) {
            return false;
        }
        
        // Get Element
        if ($obj instanceof jQuery) {
            this.$el = $obj;
        } else {
            this.$el = jQuery($obj);
        }

        this.isReady = false;
        
        // Define Options
        this.options = {
            speed: options.hasOwnProperty('speed') ? options.speed : 4,
            animateOnStop: options.hasOwnProperty('animateOnStop') ? options.animateOnStop : false,
        }

        // Define Callbacks
        this.onUpdate = options.hasOwnProperty('onUpdate') ? options.onUpdate : false;
        this.onStop = options.hasOwnProperty('onStop') ? options.onStop : false;
        
        // Animation Variables
        this.pos = {
            c: -1 * window.scrollY, // Current
            t: -1 * window.scrollY // Target
        }
        // Build DOM
        this.$wrap = jQuery('<div class="stss-wrap"/>').insertBefore(this.$el);
        this.$scroll = jQuery('<div class="stss-container"/>').appendTo(this.$wrap);
        this.$body = this.$wrap.parent();
        this.$el.appendTo(this.$scroll);
        
        this.direction = 0;
        this.velocity = 0;

        // Size Variables
        this.height = this.$scroll.height();
        this.$body.height(this.height);

        // Check if window scrolled by Hash
        if ( window.scrollY > 0 ) {
            setTimeout(function() {
                window.scrollTo({ 
                    top: 0, 
                    behavior: 'instant'
                });
                setTimeout(function() {
                    window.scrollTo({ 
                        top: _self.pos.t - _self.core.sizes.header,
                        behavior: 'instant'
                    });
                    _self.init();
                }, 100, _self);
            }, 100, _self);
        } else {
            this.init();
        }
    }
    init() {
        const _self = this;

        // Set init position
        this.$scroll.css('transform', `translateY(${parseFloat(this.pos.c).toFixed(2)}px)`);

        // Set State
        this.state = 'play'; // play, pause, stop

        // Events
        jQuery(window).on('scroll', function(e) {
            if ( _self.state === 'stop' ) {
                _self.changeState('play');
            }
        });

        this.isReady = true;
        this.$wrap.addClass('is-ready');
        this.core.$dom.body.addClass('has-smooth-scroll');
        this.layout();
    }
    getVelocity() {
        // Returns pixels per second (FPS 60)
        return parseFloat(this.velocity * 60).toFixed(2);
    }
    pause() {

    }
    changeState( state ) {
        this.state = state;
        switch( state ) {
            case 'stop':
                if ( typeof this.onStop === 'function' ) {
                    this.onStop(this);
                }
                break;
            case 'play':
                break;
            case 'pause':
                break;
        }
    }
    resize() {
        if ( this.isReady ) {
            this.height = this.$scroll.height();
            this.$body.height(this.height);
        }
    }
    updateScroll( deltaTime = 0 ) {
        // Check Height
        if ( this.height != this.$scroll.height() ) {
            this.resize();
        }
        if ( deltaTime === 0) {
            //console.warn('Scroll Delta is 0');
            return false;
        }
        let fpsChunk = parseFloat(deltaTime/0.01667).toFixed(3);

        // Get current scroll position
        this.pos.t = Math.round(-1 * window.scrollY);

        if ( this.options.animateOnStop && this.state === 'stop' ) {
            this.pos.c = this.pos.t;
        } else {
            if ( parseFloat(this.pos.c).toFixed(1) === 0 && parseFloat(this.pos.t).toFixed(1) === 0 ) {
                this.changeState('stop');
                return false;
            } else if ( parseFloat(this.pos.c).toFixed(1) != parseFloat(this.pos.t).toFixed(1) ) {
                this.state = 'play';
                
                // Calculate Velocity
                if (deltaTime === 0) { 
                    return false;
                }
                //this.velocity = (this.pos.t - this.pos.c) * parseFloat(deltaTime).toFixed(3) * this.options.speed;
                this.velocity = (this.pos.t - this.pos.c) * parseFloat(deltaTime * fpsChunk).toFixed(3) * this.options.speed;
                
                if ( this.velocity < -1 || this.velocity > 1 ) {
                    this.velocity = Math.round(this.velocity);
                }
                if ( this.velocity > -0.1 && this.velocity < 0.1 ) {
                    this.pos.c = this.pos.t;
                    this.changeState('stop');
                }

                this.pos.c += this.velocity;

                // Trigger Scroll Event
                jQuery(window).trigger('scroll');
                
                if ( typeof this.onUpdate === 'function' ) {
                    this.onUpdate(this);
                }
            } else {
                this.changeState('stop');
            }
        }

        // Add Scrolling Class
        if ( this.pos.t < -1 * this.core.sizes.header ) {
            this.$wrap.addClass('is-scrolled');
        } else {
            this.$wrap.removeClass('is-scrolled');
        }
        
        // Update position
        this.$scroll.css('transform', `translateY(${parseFloat(this.pos.c).toFixed(2)}px)`);
    }
    layout() {
        this.resize();
    }
}

// Scroll Animation Platform
class ST_SAP {
    constructor( core = null )  {
        if ( core === null ) {
            return false;
        }
        const _self = this;
        
        // Values
        this.screen_height = jQuery(window).height();
        this.screen_width = jQuery(window).width();
        this.core = core; 

        // Containers 
        this.items = [];
        this.horizontal_scroll = [];
        this.mouse_position = {
            x: 0,
            y: 0
        }

        // Run Calculation
        this.layout();

        // Mouse Events
        window.addEventListener('mousemove', (e) => { //-1 => 1
            _self.mouse_position.x = (2 * e.clientX - window.innerWidth)/window.innerWidth;
            _self.mouse_position.y = (2 * e.clientY - window.innerHeight)/window.innerHeight;
        });

        // Window Events
        this.core.$dom.win.on('resize', function() {
            _self.layout();
        }).on('load', function() {
            _self.layout();
        }).on('ST_LIL', function() {
            _self.layout();
        });
    }

    // --- PARALLAX MEDIA --- //
    addParallaxMedia( elem = null, options = {} ) {
        if ( elem === null ) {
            console.warn('Cannot add Parallax Media Item. Element is not specified.');
            return false;
        }
        const _self = this;
        const item = {
            $el: elem instanceof jQuery ? elem : jQuery(elem),
            top: 0,
            height: 0,
            speed: options.hasOwnProperty('speed') ? parseInt(options.speed) * 0.01 : 0.05,
            direction: options.hasOwnProperty('dir') ? options.dir : 'vertical',
            mouse_cx: 0,
            calculate: function() {
                let offset_fix = _self.core.scroll !== null ? _self.core.scroll.$scroll.offset().top : 0;
                this.$el.css('transform', 'translateY(0px) scale('+ ( 1 + this.speed ) +')');
                this.height = this.$wrap.height();
                this.start = this.$wrap.offset().top - _self.screen_height - offset_fix;
                this.end = this.$wrap.offset().top + this.height - offset_fix;
                this.path = this.end - this.start;
                this.scrollPath = this.height * this.speed;
                this.update(_self.core.getCurrentScroll());
            },
            update: function( cs ) {
                let t = 0;
                if ( cs < this.start ) {
                    t = -1;
                } else if ( cs > this.end ) {
                    t = 1;
                } else {
                    t = 2 * (cs - this.start)/this.path - 1;
                }
                this.$el.css('transform', 'translateY('+ (this.scrollPath * t) +'px) scale('+ ( 1 + this.speed ) +')');
            }
        }
        item.$wrap = item.$el.parent();
        item.$el.css({
            'transform-origin': '50% 50%'
        });
        item.calculate();
        this.items.push(item);
    }

    // --- HORIZONTAL SCROLL --- //
    addHorizontalScrollItem( elem = null, options = {} ) {
        if ( elem === null ) {
            console.warn('Cannot add Horizontal Scroll Item. Element is not specified.');
            return false;
        }
        const _self = this;
        const item = {
            $el: elem instanceof jQuery ? elem : jQuery(elem),
            height: 0,
            calculate: function() {
                let offset_fix = _self.core.scroll !== null ? _self.core.scroll.$scroll.offset().top : 0;
                this.$el.css('transform', `translate(0px, 0px)`);
                this.height = this.$el.height();
                this.width = this.$el.width();
                this.padding = 0.5 * (_self.screen_height - this.height);
                this.scroll_path = this.width - this.$parent.width();
                this.parent_height = this.width + _self.screen_height;
                this.$parent.height(this.parent_height).css('padding', this.padding + 'px 0');
                this.start = this.$parent.offset().top - offset_fix;
                this.end = this.start + this.parent_height - _self.screen_height + 2 * this.padding;
                this.path = this.end - this.start;
                if ( _self.core.scroll === null ) {
                    this.$el.css('top', this.padding + 'px');
                }
                this.update(_self.core.getCurrentScroll());
            },
            update: function( cs ) {
                let t = 0;
                let sticky_path = 0;
                if ( cs < this.start ) {
                    t = 0;
                } else if ( cs > this.end ) {
                    t = 1;
                    sticky_path = this.end - this.start;
                } else {
                    // Animate
                    t = (cs - this.start)/this.path;
                    sticky_path = cs - this.start;
                }
                if ( _self.core.scroll === null ) {
                    sticky_path = 0;
                }
                this.$el.css('transform', `translate(-${(this.scroll_path * t)}px, ${sticky_path}px)`);
            }
        }
        item.$parent = item.$el.parent();
        item.calculate();
        if ( _self.core.scroll === null ) {
            item.$parent.css('position', 'relative');
            item.$el.css('position', 'sticky');
        }
        this.horizontal_scroll.push(item);
    }

    // --- STICKY ITEM --- //
    addStickyItem( elem = null, options = {} ) {
        if ( elem === null ) {
            console.warn('Cannot add Sticky Item. Element is not specified.');
            return false;
        }
        const _self = this;
        const item = {
            $el: elem instanceof jQuery ? elem : jQuery(elem),
            $parent: elem instanceof jQuery ? elem.parent() : jQuery(elem).parent(),
            position: options.hasOwnProperty('position') ? options.position : 'center',
            calculate: function() {
                let offset_fix = _self.core.scroll !== null ? _self.core.scroll.$scroll.offset().top : 0;
                this.$el.css('transform', 'translateY(0px)');
                this.height = this.$el.height();
                if ( _self.core.scroll !== null ) {
                    // Smooth Scroll Values
                    this.p_height = this.$parent.height();
                    this.top = this.$el.offset().top - offset_fix;
                    this.offset = this.height * this.origin;
                    
                    switch ( this.position ) {
                        case 'top':
                            this.start = this.top + this.offset;
                            break;
                        case 'header':
                            this.start = this.top - _self.core.sizes.header + this.offset;
                            break;
                        case 'center':
                            this.start = this.top - 0.5 * _self.screen_height + this.offset;
                            break;
                        case 'bottom':
                            this.start = this.top - _self.screen_height + this.offset;
                            break;
                        default:
                            // % or PX value
                            let top_offset = 0;
                            if ( this.position.indexOf('vw') > 0 || this.position.indexOf('%') > 0 ) {
                                top_offset = parseFloat(this.position) * 0.01 * _self.screen_height;
                            } else if ( parseFloat(this.position) <= 1 ) {
                                top_offset = parseFloat(this.position) * _self.screen_height;
                            } else {
                                top_offset = parseFloat(this.position);
                            }
                            this.start = this.top - top_offset + this.offset;
                            break; 
                    }
                    this.end = this.start + this.p_height - this.height;
                    this.update(_self.core.getCurrentScroll());
                } else {
                    // Default Scroll Values
                    switch ( this.position ) {
                        case 'top':
                            this.$el.css('top', '0px');
                            break;
                        case 'header':
                            this.$el.css('top', `${_self.core.sizes.header}px`);
                            break;
                        case 'center':
                            this.$el.css('top', `calc(50% - ${(0.5 * this.height)}px)`);
                            break;
                        case 'bottom':
                            this.$el.css('top', `calc(100% - ${(this.height)}px)`);
                            break;
                        default:
                            if ( this.position.indexOf('vw') > 0 || this.position.indexOf('%') > 0 ) {
                                // %
                                this.$el.css('top', `${(parseFloat(this.position) * 0.01 * _self.screen_height)}px`);
                            } else if ( parseFloat(this.position) <= 1 ) {
                                // .%
                                this.$el.css('top', `${(parseFloat(this.position) * _self.screen_height)}px`);
                            } else {
                                // px
                                this.$el.css('top', `${parseFloat(this.position)}px`);
                            }
                            this.start = this.top - top_offset + this.offset;
                            break; 
                    }
                }
                
            },
            update: function( cs ) {
                if ( _self.core.scroll !== null ) {
                    // Calculate Path
                    let path = 0;
                    if ( cs > this.end ) {
                        path = this.end - this.start;
                    } else if ( cs > this.start && cs < this.end) {
                        path = cs - this.start;
                    }
                    this.$el.css('transform', 'translateY('+ (path) +'px)');
                }
            }
        }
        // Find Origin
        if ( options.hasOwnProperty('origin') && options.origin !== null ) {
            if ( options.origin.indexOf('px') > 0 ) {
                item.origin = parseInt(options.origin, 10) / item.$el.height();
            } else {
                item.origin = parseInt(options.origin, 10) * 0.01;
            }
        } else {
            switch ( item.position ) {
                case 'center':
                    item.origin = 0.5;
                    break;
                case 'bottom':
                    item.origin = 1;
                    break;
                default:
                    item.origin = 0;
                    break; 
            }
        }
        item.calculate();
        if ( _self.core.scroll === null ) {
            // Add Styles for Non Smooth scrolling
            item.$parent.css('position', 'relative');
            item.$el.css('position', 'sticky');    
        }
        this.items.push(item);
    }

    // --- EXPAND ON SCROLL --- //
    addExpandItem( elem = null, options = {} ) {
        if ( elem === null ) {
            console.warn('Cannot add Expandable Item. Element is not specified.');
            return false;
        }
        const _self = this;
        const item = {
            $el: elem instanceof jQuery ? elem : jQuery(elem),
            height: 0,
            calculate: function() {
                let offset_fix = _self.core.scroll !== null ? _self.core.scroll.$scroll.offset().top : 0;
                this.height = this.$el.height();
                this.i_scale = (this.$el.css('--st-eos-init-scale') !== undefined) ? parseFloat(this.$el.css('--st-eos-init-scale')) : 0.75,
                this.scale_path = 1 - this.i_scale,
                this.i_clip = 50 - (this.$el.css('--st-eos-init-clip') !== undefined) ? parseFloat(this.$el.css('--st-eos-init-clip')) * 50 : 12.5, // 12.5 = 25% vissibility or 0.25 in styles; 50 - fully collapsed, 0 - fully visible
                this.br = (this.$el.css('--st-eos-br') !== undefined) ? parseInt(this.$el.css('--st-eos-br'), 10) : 0,

                this.start = this.$el.offset().top - offset_fix - _self.screen_height;
                this.end = this.start + 0.5 * _self.screen_height + 0.5 * this.height;
                this.path = this.end - this.start;
            },
            update: function( cs ) {
                let t = 0;
                if ( cs < this.start ) {
                    t = 0;
                } else if ( cs > this.end ) {
                    t = 1;
                } else {
                    // Animate
                    t = (cs - this.start)/this.path;
                }
                
                this.$wrap.css('clip-path', `inset(0% ${(this.i_clip - this.i_clip * t)}% round ${this.br}px)`);
                this.$el.css('transform', 'scale('+ (this.i_scale + this.scale_path * t) +')');
            }
        }
        item.$el.wrap('<div class="st-expandable-wrap"/>');
        item.$wrap = item.$el.parent();
        item.calculate();
        this.items.push(item);
    }

    // --- SPEED CONTROL --- //
    addSpeedItem( elem = null, options = {} ) {
        if ( elem === null ) {
            console.warn('Cannot add Speed Item. Element is not specified.');
            return false;
        }
        const _self = this;
        const item = {
            $el: elem instanceof jQuery ? elem : jQuery(elem),
            top: 0,
            height: 0,
            speed: (parseFloat(options.speed) - 1),
            n_speed: (parseFloat(options.speed) - 1),
            l_speed: options.hasOwnProperty('l_speed') ? (parseFloat(options.l_speed) - 1) : null,
            t_speed: options.hasOwnProperty('t_speed') ? (parseFloat(options.t_speed) - 1) : null,
            tp_speed: options.hasOwnProperty('tp_speed') ? (parseFloat(options.tp_speed) - 1) : null,
            m_speed: options.hasOwnProperty('m_speed') ? (parseFloat(options.m_speed) - 1) : null,
            calculate: function() {
                if ( _self.screen_width < 739 && this.m_speed !== null ) {
                    this.speed = this.m_speed;
                } else if ( _self.screen_width < 960 && this.tp_speed !== null ) {
                    this.speed = this.tp_speed;
                } else if ( _self.screen_width < 1200 && this.t_speed !== null) {
                    this.speed = this.t_speed;
                } else if ( _self.screen_width < 1366 && this.l_speed !== null) {
                    this.speed = this.l_speed;
                } else {
                    this.speed = this.n_speed;
                }
                
                let offset_fix = _self.core.scroll !== null ? _self.core.scroll.$scroll.offset().top : 0;
                this.$el.css('transform', 'translateY(0px)');
                this.height = this.$el.height();
                this.top = this.$el.offset().top - offset_fix - 0.5 * _self.screen_height + 0.5 * this.height;
                this.update(_self.core.getCurrentScroll());
            },
            update: function( cs ) {
                if ( options.hasOwnProperty('speed') ) {
                    let offset = (this.top - cs) * this.speed;
                    this.$el.css('transform', 'translateY('+ (offset) +'px)');
                }
            }
        }
        item.calculate();
        this.items.push(item);
    }

    // --- TEXT FILL MASK --- //
    addTextFillMaskItem( elem = null, options = {} ) {
        if ( elem === null ) {
            console.warn('Cannot add Text Fill Mask Item. Element is not specified.');
            return false;
        }
        const _self = this;
        const item = {
            $el: elem instanceof jQuery ? elem : jQuery(elem),
            calculate: function() {
                let offset_fix = _self.core.scroll !== null ? _self.core.scroll.$scroll.offset().top : 0;
                this.height = this.$el.height();
                this.start = this.$el.offset().top - offset_fix - 0.9 * _self.screen_height;
                this.end = this.$el.offset().top - offset_fix - 0.5 * _self.screen_height + 0.5 * this.$el.height();
                this.path = this.end - this.start;
            },
            update: function( cs ) {
                let t = 0;
                if ( cs < this.start ) {
                    t = 0;
                } else if ( cs > this.end ) {
                    t = 100;
                } else {
                    // Animate
                    t = (cs - this.start)/this.path * 100;
                }
                this.$el.css('background-size', `${t}% 100%`);
            }
        }
        item.calculate();
        this.items.push(item);
    }
    update( time = {delta: 0, elapsed: 0 }, cs = window.scrollY ) {
        // Expandable Items
        this.horizontal_scroll.forEach( entry => {
            entry.update( cs );
        });
        // Other Items
        this.items.forEach( entry => {
            entry.update( cs );
        });
    }
    layout() {
        this.screen_height = jQuery(window).height();

        // Calculate new Values
        this.horizontal_scroll.forEach( entry => {
            entry.calculate();
        });
        this.items.forEach( entry => {
            entry.calculate();
        });
    }
}

class ST_iCursor {
    constructor( core = null, options = {} )  {
        if ( core === null) {
            console.warn('iCursor: Core is not specified');
            return false;
        }
        const _self = this;
        this.core = core;
        this.$el = jQuery('<div class="'+ PREFIX +'-cursor"/>').appendTo( jQuery('body') );
        this.$win = jQuery(window);

        this.screen = {
            width: this.$win.width(),
            height: this.$win.height()
        }
        this.position = {
            x: jQuery(this).innerWidth * 0.5,
            y: window.innerHeight * 0.5,
            lerpX: window.innerWidth * 0.5,
            lerpY: window.innerHeight * 0.5,
        };

        // States
        this.isActive = false;
        this.isFixed = false;
        this.isTouch = this.core.isTouchDevice;

        // Append UI
        this.$el.append('<div class="'+ PREFIX +'-cursor--pointer"/></div>');
        this.$el.append('<div class="'+ PREFIX +'-cursor--spiner"/>');
        this.$el.append('<div class="'+ PREFIX +'-cursor--arrowsEW"/>');
        this.$el.append('<div class="'+ PREFIX +'-cursor--arrowsNS"/>');

        // Set cusror from previous page
        if ( window.localStorage.getItem(PREFIX + '_prev_cursor') !== null ) {
            let prevCursor = JSON.parse(window.localStorage.getItem(PREFIX + '_prev_cursor'));
            if ( prevCursor.state === true ) {
                _self.$el.addClass('is-init');
                _self.isActive = true;
                _self.position = prevCursor.position;
            }
        }

        // Events
        jQuery(document)
            .on('touchstart', function(e) {
                _self.isTouch = true;
                _self.isActive = false;
                _self.$el.removeClass('is-init');
            })
            .on('mouseenter', function(e) {
                if ( ! _self.isTouch ) {
                    _self.isActive = true;
                    _self.position.x = e.clientX;
                    _self.position.y = e.clientY;
                    _self.$el.addClass('is-init');
                }
            })
            .on('mousemove', function(e) {
                if (_self.isActive) {
                    _self.position.x = e.clientX;
                    _self.position.y = e.clientY;
                    if (!_self.$el.hasClass('is-init')) {
                        _self.$el.addClass('is-init');
                    }
                }
            })
            .on('mouseleave', function(e) {
                _self.$el.removeClass('is-init');
            })
            .on('mouseenter', this.core.cfg.iCursor.cursorHover, function() {
                if (_self.isActive) {
                    _self.setState('is-hover');
                    jQuery(this).on('mouseleave', function() {
                        _self.unsetState('is-hover');
                    });
                }
            })
            .on('mouseenter', this.core.cfg.iCursor.cursorscrollEW, function() {
                if (_self.isActive) {
                    _self.setState('is-scrollEW');
                    jQuery(this).on('mouseleave', function() {
                        _self.unsetState('is-scrollEW');
                    });
                }
            })
            .on('mouseenter', this.core.cfg.iCursor.cursorscrollNS, function() {
                if (_self.isActive) {
                    _self.setState('is-scrollNS');
                    jQuery(this).on('mouseleave', function() {
                        _self.unsetState('is-scrollNS');
                    });
                }
            });
    }
    setState( state = null ) {
        if ( state !== null ) {
            this.$el.addClass( state );
        } else {
            return false;
        }
    }
    unsetState( state = null) {
        if ( state !== null ) {
            if ('all' === state) {
                this.$el.removeAttr('class').addClass(PREFIX + '-cursor is-init');
            } else {
                this.$el.removeClass(state);
            }
        } else {
            return false;
        }
    }
    update( delta = 0 ) {
        if ( this.isActive ) {
            this.position.lerpX += (this.position.x - this.position.lerpX ) * 10 * delta;
            this.position.lerpY += (this.position.y - this.position.lerpY) * 10 * delta;
            this.$el.css('transform', 'translate('+ this.position.lerpX +'px, '+ this.position.lerpY +'px)');
        }
    }
}