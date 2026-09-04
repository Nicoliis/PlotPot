class UI {
  /**
   * Factory method - starts building an element
   * @param {string} tagName 
   * @returns {UIElementBuilder}
   */
  static make(tagName) {
    return new UIElementBuilder(tagName);
  }

  /**
   * Quick alias for document.createElement
   * @param {string} tagName 
   * @returns {HTMLElement}
   */
  static create(tagName) {
    return document.createElement(tagName);
  }
  
  /**
   * Quick alias for document.getElementById
   * @param {string} id
   * @returns {HTMLElement}
   */
  static get(id) {
    return document.getElementById(id);
  }
}

class UIElementBuilder {
  #element;
  #parent = null;

  constructor(tagName) {
    this.#element = document.createElement(tagName);
  }

  /**
   * Add one or more class names
   * @param {...string} classNames 
   * @returns {this}
   */
  class(...classNames) {
    this.#element.classList.add(...classNames.filter(Boolean));
    return this;
  }

  /**
   * Set id
   * @param {string} id 
   * @returns {this}
   */
  id(id) {
    this.#element.id = id;
    return this;
  }

  /**
   * Set text content
   * @param {string} text 
   * @returns {this}
   */
  text(text) {
    this.#element.textContent = text ?? '';
    return this;
  }

  /**
   * Set value (for input/textarea/select)
   * @param {string} value 
   * @returns {this}
   */
  value(value) {
    this.#element.value = value ?? '';
    return this;
  }

  /**
   * Set placeholder
   * @param {string} placeholder 
   * @returns {this}
   */
  placeholder(placeholder) {
    this.#element.placeholder = placeholder ?? '';
    return this;
  }

  /**
   * Set this element as parent for next chained elements
   * (very useful for fluent nested building)
   * @returns {this}
   */
  childOf(parent) {
    if (parent instanceof UIElementBuilder) {
      this.#parent = parent;
      parent.#element.appendChild(this.#element);
    } else if (parent instanceof Node) {
      this.#parent = parent;
      parent.appendChild(this.#element);
    }
    return this;
  }

  /**
   * Append children (elements, builders or DOM nodes)
   * @param {...(HTMLElement | UIElementBuilder | null | undefined)} children 
   * @returns {this}
   */
  withChilds(...children) {
    for (const child of children) {
      if (!child) continue;
      const node = child instanceof UIElementBuilder ? child.getElement() : child;
      if (node instanceof Node) {
        this.#element.appendChild(node);
      }
    }
    return this;
  }

  /**
   * Add inline style object
   * @param {Record<string, string>} styles 
   * @returns {this}
   */
  style(styles) {
    Object.assign(this.#element.style, styles);
    return this;
  }

  /**
   * Add multiple attributes at once
   * @param {Record<string, string>} attrs 
   * @returns {this}
   */
  attrs(attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      this.#element.setAttribute(key, value);
    }
    return this;
  }

  /**
   * Add event listener
   * @param {string} type 
   * @param {EventListenerOrEventListenerObject} listener 
   * @param {boolean|AddEventListenerOptions} [options]
   * @returns {this}
   */
  on(type, listener, options) {
    this.#element.addEventListener(type, listener, options);
    return this;
  }

  /**
   * Immediately run any function that receives the current element.
   * Most common uses:
   *   - attach complex event listeners
   *   - do one-off DOM manipulations that don't deserve their own chain method
   *   - read/modify properties right after creation
   *
   * @param {([el]: HTMLElement, [self]: UIElementBuilder) => void} callback
   * @returns {this}
   * @chainable
   * @example
   * UI.make('input')
   *   .type('checkbox')
   *   .execute(el => el.checked = true)
   *   .on('change', handleToggle)
   */
  execute(callback) {
    if (typeof callback === 'function') {
      callback(this.#element,this);
    }
    return this;
  }
  
  /**
   * This obtains the element for outside manipulation.
   * @returns {HTMLElement}
   */
  getElement() {
    return this.#element;
  }

  /**
   * This focuses the element builded.
   * @returns {this}
   */
  focus() {
    this.#element.focus();
    return this;
  }

  /**
   * this sets the attribute type of the element.
   * @param {string} type 
   * @returns {this}
   */
  ofType(type) {
    this.#element.type = type;
    return this
  }

  /**
   * this sets the attribute textContent of the element.
   * @param {string} textContent 
   * @returns {this}
   */
  textContent(textContent) {
    this.#element.textContent = textContent;
    return this
  }

  /**
   * this sets the attribute draggable of the element.
   * @param {string} draggable 
   * @returns {this}
   */
  draggable(draggable) {
    this.#element.draggable = draggable;
    return this
  }

  /**
   * this sets the attribute innerHTML of the element.
   * @param {string} innerHTML 
   * @returns {this}
   */
  innerHTML(innerHTML) {
    this.#element.innerHTML = innerHTML;
    return this
  }

  /**
   * this sets the attribute name of the element.
   * @param {string} name
   * @returns {this}
   */
  name(name) {
    this.#element.name = name;
    return this
  }

  /**
   * this sets the attribute checked of the element.
   * @param {string} checked
   * @returns {this}
   */
  checked(checked) {
    this.#element.checked = checked;
    return this
  }

  /**
   * this sets the attribute dataset of the element.
   * @param {string} dataset 
   * @returns {this}
   */
  dataset(dataset) {
    for (const [key, value] of Object.entries(dataset)) {
      this.#element.dataset[key] = value;
    }
    return this;
  }
}