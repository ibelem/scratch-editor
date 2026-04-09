import bindAll from 'lodash.bindall';
import React from 'react';
import PropTypes from 'prop-types';
import {defineMessages, injectIntl} from 'react-intl';
import intlShape from './intlShape';
import {connect} from 'react-redux';
import queryString from 'query-string';

import log from './log';
import {getProjectTitleFromFilename} from './sb-file-uploader-utils';
import {
    LoadingStates,
    getIsLoadingUpload,
    getIsShowingProject,
    onLoadedProject,
    requestProjectUpload
} from '../reducers/project-state';
import {setProjectTitle} from '../reducers/project-title';
import {
    openLoadingProject,
    closeLoadingProject
} from '../reducers/modals';

const messages = defineMessages({
    loadError: {
        id: 'gui.urlProjectLoader.loadError',
        defaultMessage: 'The project at the given URL could not be loaded.',
        description: 'An error that displays when loading a project from a URL fails.'
    }
});

/**
 * Higher Order Component to load a Scratch project from a URL specified via the
 * `?url=` query parameter. When the app starts, if `?url=https://…/project.sb3`
 * is present and reachable, the project is fetched and loaded automatically.
 *
 * The HOC waits until the default project is showing (isShowingProject) before
 * triggering the upload-loading flow, so it integrates cleanly with the existing
 * state machine. It coordinates with SBFileUploaderHOC by delegating control of
 * the LOADING_VM_FILE_UPLOAD state: SBFileUploaderHOC steps aside when it has no
 * staged file, letting this HOC drive the load.
 *
 * @param {React.Component} WrappedComponent component to wrap
 * @returns {React.Component} component with URL project loading behavior
 */
const UrlProjectLoaderHOC = function (WrappedComponent) {
    class UrlProjectLoaderComponent extends React.Component {
        constructor (props) {
            super(props);
            bindAll(this, [
                'loadFromUrl',
                'trigger'
            ]);

            const queryParams = queryString.parse(location.search);
            // Support a single `?url=` value; ignore duplicates
            const urlParam = Array.isArray(queryParams.url)
                ? queryParams.url[0]
                : queryParams.url;

            // Only allow http/https URLs to prevent javascript: and similar schemes
            if (urlParam && /^https?:\/\//i.test(urlParam)) {
                this.projectUrl = urlParam;
            } else {
                this.projectUrl = null;
            }

            this.projectData = null;  // ArrayBuffer received from fetch
            this.triggered = false;   // ensures we only load once
            this.mounted = false;
            this.abortController = null;
        }

        componentDidMount () {
            this.mounted = true;
            if (!this.projectUrl) return;

            this.abortController = new AbortController();
            fetch(this.projectUrl, {signal: this.abortController.signal})
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.arrayBuffer();
                })
                .then(data => {
                    if (!this.mounted) return;
                    this.projectData = data;
                    // If the default project finished loading before the fetch
                    // completed, trigger the URL load now.
                    if (this.props.isShowingProject && !this.triggered) {
                        this.trigger();
                    }
                })
                .catch(err => {
                    if (!this.mounted || err.name === 'AbortError') return;
                    log.warn('url-project-loader: fetch failed', err);
                    // eslint-disable-next-line no-alert
                    alert(this.props.intl.formatMessage(messages.loadError));
                });
        }

        componentDidUpdate (prevProps) {
            // Once the default project is shown AND the URL data is ready, kick
            // off the loading state transition.
            if (
                !this.triggered &&
                !prevProps.isShowingProject &&
                this.props.isShowingProject &&
                this.projectData
            ) {
                this.trigger();
            }

            // Once the Redux state transitions to LOADING_VM_FILE_UPLOAD (which
            // this HOC requested), load the fetched data into the VM.
            if (
                this.triggered &&
                this.props.isLoadingUpload &&
                !prevProps.isLoadingUpload
            ) {
                this.loadFromUrl();
            }
        }

        componentWillUnmount () {
            this.mounted = false;
            if (this.abortController) {
                this.abortController.abort();
            }
        }

        trigger () {
            this.triggered = true;
            this.props.requestProjectUpload(this.props.loadingState);
        }

        loadFromUrl () {
            this.props.onLoadingStarted();

            // Extract the filename from the URL path (strip query string)
            let filename = '';
            try {
                filename = new URL(this.projectUrl).pathname.split('/').pop();
            } catch {
                filename = this.projectUrl.split('/').pop().split('?')[0];
            }

            let loadingSuccess = false;
            this.props.vm.loadProject(this.projectData)
                .then(() => {
                    const title = getProjectTitleFromFilename(filename);
                    if (title) {
                        this.props.onSetProjectTitle(title);
                    }
                    loadingSuccess = true;
                })
                .catch(err => {
                    log.warn('url-project-loader: vm.loadProject failed', err);
                    // eslint-disable-next-line no-alert
                    alert(this.props.intl.formatMessage(messages.loadError));
                })
                .then(() => {
                    this.props.onLoadingFinished(this.props.loadingState, loadingSuccess);
                });
        }

        render () {
            const {
                intl, // eslint-disable-line no-unused-vars
                isLoadingUpload,
                isShowingProject,
                loadingState,
                onLoadingFinished,
                onLoadingStarted,
                onSetProjectTitle,
                requestProjectUpload: requestProjectUploadProp,
                vm,
                ...componentProps
            } = this.props;
            return (
                <WrappedComponent
                    {...componentProps}
                />
            );
        }
    }

    UrlProjectLoaderComponent.propTypes = {
        intl: intlShape.isRequired,
        isLoadingUpload: PropTypes.bool,
        isShowingProject: PropTypes.bool,
        loadingState: PropTypes.oneOf(LoadingStates),
        onLoadingFinished: PropTypes.func,
        onLoadingStarted: PropTypes.func,
        onSetProjectTitle: PropTypes.func,
        requestProjectUpload: PropTypes.func,
        vm: PropTypes.shape({
            loadProject: PropTypes.func
        })
    };

    const mapStateToProps = state => {
        const loadingState = state.scratchGui.projectState.loadingState;
        return {
            isLoadingUpload: getIsLoadingUpload(loadingState),
            isShowingProject: getIsShowingProject(loadingState),
            loadingState,
            vm: state.scratchGui.vm
        };
    };

    const mapDispatchToProps = (dispatch, ownProps) => ({
        onLoadingFinished: (loadingState, success) => {
            dispatch(onLoadedProject(loadingState, ownProps.canSave, success));
            dispatch(closeLoadingProject());
        },
        onLoadingStarted: () => dispatch(openLoadingProject()),
        onSetProjectTitle: title => dispatch(setProjectTitle(title)),
        requestProjectUpload: loadingState => dispatch(requestProjectUpload(loadingState))
    });

    // Allow incoming props to override Redux-provided props. Used to mock in tests.
    const mergeProps = (stateProps, dispatchProps, ownProps) => Object.assign(
        {}, stateProps, dispatchProps, ownProps
    );

    return injectIntl(connect(
        mapStateToProps,
        mapDispatchToProps,
        mergeProps
    )(UrlProjectLoaderComponent));
};

export {
    UrlProjectLoaderHOC as default
};
