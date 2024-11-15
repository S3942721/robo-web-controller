const base_url = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * @typedef RequestParams
 * @property {Boolean} returns_json whether the resolve is json, default to true
 */

/**
 * @type {RequestParams}
 */
const default_params = {
    returns_json: true
}

/**
 * @type {RequestInit}
 */
const default_init = {
    method: 'POST',
    headers: {
        'Content-Type': "application/json",
    }
}

/**
 * wrap request, returns null if error happens
 * @param {RequestInit} init 
 * @param {RequestParams} params
 * @returns {Promise<any>}
 */
export default async function request(url, init, params = {}) {
    params = {
        ...default_params,
        ...params
    }

    init = {
        ...default_init,
        ...init
    }

    if(init.body && typeof init.body === 'object') {
        init.body = JSON.stringify(init.body);
    }

    const { returns_json } = params;

    const resp = await fetch(`${base_url}/${url}`, init);
    if(!resp.ok) {
        console.error(resp.statusText);
        return null;
    }

    if(returns_json) {
        try {
            return await resp.json();
        } catch(error) {
            console.error(error);
            return null;
        }
    } else {
        return resp;
    }
}