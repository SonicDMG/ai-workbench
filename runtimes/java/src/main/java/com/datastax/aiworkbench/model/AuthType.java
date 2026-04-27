package com.datastax.aiworkbench.model;

/** Authentication scheme for a service endpoint. */
public enum AuthType {
    none,
    api_key,
    oauth2,
    mTLS;
}
