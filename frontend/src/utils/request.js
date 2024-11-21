const base_url = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * @typedef RequestParams
 * @property {Boolean} returns_json whether the resolve is json, default to true
 * @property {Boolean} not_override_body whether should not parse body to string, default to false
 */

/**
 * @type {RequestParams}
 */
const default_params = {
    returns_json: true,
    not_override_body: false
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

    const { returns_json, not_override_body } = params;

    if(init.body && typeof init.body === 'object' && !not_override_body) {
        init.body = JSON.stringify(init.body);
    }

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