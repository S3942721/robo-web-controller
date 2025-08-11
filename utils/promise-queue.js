class PromiseQueue {
    constructor() {
        this.queue = []
        this.pendingQueue = []
        this.completed = false
    }

    shift () {
        this.queue.shift()
    }

    next () {
        if (this.queue.length) {
            return Promise.resolve(this.queue.shift())
        } else {
            return new Promise((resolve) => {
                this.pendingQueue.push(resolve)
            })
        }
    }

    add (item) {
        if (!Array.isArray(item)) {
            this._addSingle(item)
        } else {
            for (const i of item) {
                this._addSingle(i)
            }
        }
    }

    _addSingle (item) {
        if (this.completed) {
            console.warn('[PromiseQueue] Ignored task enqueue after completion.')
            return
        }
        if (this.pendingQueue.length) {
            this.pendingQueue.shift()(item)
        } else {
            this.queue.push(item)
        }
    }

    complete () {
        this.completed = true
        this.pendingQueue.forEach(resolve => resolve(null))
    }
}

module.exports = PromiseQueue
