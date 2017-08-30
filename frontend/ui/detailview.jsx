import React from 'react';
import _ from 'lodash';
import { Button, FormGroup, Input, Label, Modal, ModalBody, ModalHeader, ModalFooter, Row, Col, Container } from 'reactstrap';
import { Helmet } from 'react-helmet';
import { connect } from 'react-redux';
import Loading from './loading.jsx';
import MeasureGraph from './measuregraph.jsx';
import SubViewNav from './subviewnav.jsx';
import { DEFAULT_TIME_INTERVAL, TIME_INTERVALS } from '../schema';

const mapStateToProps = (state, ownProps) => {
  const measure = ownProps.match.params.measure;
  const cacheKey = `${ownProps.match.params.platform}-${ownProps.match.params.channel}-${measure}`;
  const measureData = state.measures[cacheKey];

  return { measureData };
};

const normalizeSeries = (seriesList, measure) =>
 seriesList.map(series => ({
   ...series,
   data: series.data.map(d => ({
     ...d,
     [measure]: d[measure] / (d.usage_hours / 1000.0)
   }))
 }));

const getOptionalParameters = (props) => {
  const urlParams = new URLSearchParams(props.location.search);
  const dateParamRe = /^(\d+-\d+-\d+)-(\d+-\d+-\d+)$/;

  // time interval can either be specified as an interval (starting from the present) or a set of dates
  const validTimeIntervals = _.clone(TIME_INTERVALS);
  let timeInterval = urlParams.get('timeInterval') ? urlParams.get('timeInterval') : DEFAULT_TIME_INTERVAL;
  if (_.isString(timeInterval)) {
    if (timeInterval.match(dateParamRe)) {
      const args = timeInterval.match(dateParamRe);
      timeInterval = {
        startDate: new Date(args[1]),
        endDate: new Date(args[2])
      };
      validTimeIntervals.unshift({
        label: `${args[1]} → ${args[2]}`,
        value: timeInterval
      });
    } else {
      timeInterval = parseInt(timeInterval, 10);
    }
  }

  // coerce normalized into a boolean, true if not specified
  let normalized = true;
  if (urlParams.get('normalized')) {
    normalized = (parseInt(urlParams.get('normalized'), 10));
  }

  // disabledBuildIds is a comma-seperated list
  let disabledBuildIds = new Set();
  if (urlParams.get('disabledBuildIds')) {
    disabledBuildIds = new Set(urlParams.get('disabledBuildIds').split(','));
  }

  return {
    timeInterval,
    validTimeIntervals,
    normalized,
    disabledBuildIds
  };
};

class DetailViewComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      channel: props.match.params.channel,
      platform: props.match.params.platform,
      measure: props.match.params.measure,
      isLoading: true,
      customStartDate: undefined,
      customEndDate: undefined,
      fetchMeasureData: this.props.fetchMeasureData,
      disabledBuildIds: new Set(),
      seriesList: [],
      ...getOptionalParameters(props)
    };

    this.timeIntervalChanged = this.timeIntervalChanged.bind(this);
    this.cancelChooseCustomTimeInterval = this.cancelChooseCustomTimeInterval.bind(this);
    this.customTimeIntervalChosen = this.customTimeIntervalChosen.bind(this);
    this.customStartDateChanged = this.customStartDateChanged.bind(this);
    this.customEndDateChanged = this.customEndDateChanged.bind(this);
    this.isCustomTimeIntervalValid = this.isCustomTimeIntervalValid.bind(this);
    this.normalizeCheckboxChanged = this.normalizeCheckboxChanged.bind(this);
    this.versionCheckboxChanged = this.versionCheckboxChanged.bind(this);
  }

  componentDidMount() {
    this.fetchMeasureData(this.state);
  }

  fetchMeasureData(params) {
    this.setState({ isLoading: true });
    this.state.fetchMeasureData(params).then(() =>
      this.setState({
        seriesList: this.getSeriesList(),
        isLoading: false
      }));
  }

  getSeriesList() {
    const measure = this.props.match.params.measure;

    const seriesMap = {};
    _.forEach(this.props.measureData, (build, buildId) => {
      if (this.state.disabledBuildIds.has(buildId)) {
        return;
      }
      if (!seriesMap[build.version]) {
        seriesMap[build.version] = {};
      }
      build.data.forEach((datum) => {
        const date = datum[0];
        if (!seriesMap[build.version][date]) {
          seriesMap[build.version][date] = {
            [measure]: 0,
            usage_hours: 0,
            date: new Date(date)
          };
        }

        seriesMap[build.version][date][measure] += datum[1];
        seriesMap[build.version][date].usage_hours += datum[2];
      });
    });

    // if we have less than 3 series, just return all verbatim
    if (Object.keys(seriesMap).length < 3) {
      return _.map(seriesMap, (data, version) => ({
        name: version,
        data: _.values(data)
      }));
    }

    // take two most recent versions
    let mostRecent = Object.keys(seriesMap).sort().slice(-2);

    // if the second most recent has negligible results (<10% of) relative to the most
    // recent, just concatenate it in with the other results under "other"
    if (_.sum(_.values(seriesMap[mostRecent[0]]).map(d => d.usage_hours)) /
        _.sum(_.values(seriesMap[mostRecent[1]]).map(d => d.usage_hours)) < 0.10) {
      mostRecent = [mostRecent[1]];
    }

    const aggregated = _.reduce(
      _.filter(seriesMap, (series, version) => _.indexOf(mostRecent, version) === (-1)),
      (result, series) => {
        const newResult = _.clone(result);
        _.values(series).forEach((datum) => {
          if (!newResult[datum.date]) {
            newResult[datum.date] = _.clone(datum);
          } else {
            _.keys(newResult[datum.date]).forEach((k) => {
              if (k === measure || k === 'usage_hours') {
                newResult[datum.date][k] += datum[k];
              }
            });
          }
        });
        return newResult;
      }, {});

    return _.concat(mostRecent.map(version => ({
      name: version,
      data: _.values(seriesMap[version])
    })), [{ name: 'Older', data: _.values(aggregated) }]);
  }

  navigate(newParams, updateSeriesList = true) {
    this.setState(newParams, () => {
      if (updateSeriesList) {
        this.setState({
          seriesList: this.getSeriesList()
        });
      }
    });

    const paramStr = ['timeInterval', 'normalized', 'disabledBuildIds'].map((paramName) => {
      let value = (!_.isUndefined(newParams[paramName])) ? newParams[paramName] : this.state[paramName];
      if (typeof (value) === 'boolean') {
        value = value ? 1 : 0;
      } else if (typeof (value) === 'object') {
        value = Array.from(value);
      }
      return `${paramName}=${value}`;
    }).join('&');
    this.props.history.push(`/${this.state.channel}/${this.state.platform}/${this.state.measure}?${paramStr}`);
  }

  timeIntervalChanged(ev) {
    const value = parseInt(ev.target.value, 10);
    if (!value) {
      // value = 0 => let user select a custom time interval
      this.setState({
        choosingCustomTimeInterval: true,
        customStartDate: undefined,
        customEndDate: undefined
      });
    } else {
      const newParams = {
        timeInterval: value
      };
      this.navigate(newParams, false);
      this.fetchMeasureData({
        ...this.state,
        ...newParams
      });
    }
  }

  customStartDateChanged(ev) {
    this.setState({
      customStartDate: ev.target.value
    });
  }

  customEndDateChanged(ev) {
    this.setState({
      customEndDate: ev.target.value
    });
  }

  cancelChooseCustomTimeInterval() {
    this.setState({
      choosingCustomTimeInterval: false
    });
  }

  customTimeIntervalChosen() {
    this.setState({
      choosingCustomTimeInterval: false
    });
    const timeIntervalStr = `${this.state.customStartDate}-${this.state.customEndDate}`;
    this.props.history.push(`/${this.state.channel}/${this.state.platform}/${this.state.measure}?timeInterval=${timeIntervalStr}`);
  }

  isCustomTimeIntervalValid() {
    return (this.state.customStartDate && this.state.customEndDate &&
            this.state.customStartDate < this.state.customEndDate);
  }

  normalizeCheckboxChanged(ev) {
    this.navigate({
      normalized: ev.target.checked
    });
  }

  versionCheckboxChanged(ev) {
    const buildId = ev.target.name;
    const disabled = !ev.target.checked;
    const disabledBuildIds = new Set(this.state.disabledBuildIds);

    if (disabled) {
      disabledBuildIds.add(buildId);
    } else {
      disabledBuildIds.delete(buildId);
    }

    this.navigate({
      disabledBuildIds
    });
  }

  render() {
    return (
      <div className="body-container">
        <Helmet>
          <title>
            { `${this.state.platform} ${this.state.channel} ${this.state.measure}` }
          </title>
        </Helmet>

        <SubViewNav
          className="header-element"
          breadcrumbs={[
            { name: 'Home', link: '/' },
            { name: `${this.state.platform} ${this.state.channel}`,
              link: `/${this.state.channel}/${this.state.platform}` },
            { name: this.state.measure,
              link: `/${this.state.channel}/${this.state.platform}/${this.state.measure}` }
          ]} />
        <div className="body-element">
          <div className="container center">
            <Row>
              <form className="form-inline">
                <select
                  value={this.state.timeInterval}
                  onChange={this.timeIntervalChanged}
                  className="mb-2 mr-sm-2 mb-sm-0">
                  {
                    this.state.validTimeIntervals.map(
                      timeInterval => (
                        <option
                          key={timeInterval.value}
                          value={timeInterval.value}>
                          {timeInterval.label}
                        </option>
                      )
                    )
                  }
                  <option value="0">Custom...</option>
                </select>
                <Modal
                  isOpen={this.state.choosingCustomTimeInterval}
                  toggle={this.cancelChooseCustomTimeInterval}>
                  <ModalHeader toggle={this.cancelChooseCustomTimeInterval}>
                    Custom Date Range
                  </ModalHeader>
                  <ModalBody>
                    <FormGroup>
                      <Label for="startDate">
                        Start Date
                      </Label>
                      <Input
                        type="date"
                        onChange={this.customStartDateChanged}
                        id="startDate" />
                    </FormGroup>
                    <FormGroup>
                      <Label for="endDate">
                        End Date
                      </Label>
                      <Input
                        type="date"
                        onChange={this.customEndDateChanged}
                        id="endDate" />
                    </FormGroup>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      color="primary"
                      disabled={!this.isCustomTimeIntervalValid()}
                      onClick={this.customTimeIntervalChosen}>Ok</Button>
                  </ModalFooter>
                </Modal>
                <FormGroup
                  check
                  title="Normalize measure by number of usage hours">
                  <Label check>
                    <Input
                      type="checkbox"
                      checked={this.state.normalized}
                      onChange={this.normalizeCheckboxChanged} />
                    {' '}
                    Normalize
                  </Label>
                </FormGroup>
              </form>
            </Row>
            {
              this.state.isLoading &&
              <Row>
                <Loading />
              </Row>
            }
            {
              !this.state.isLoading &&
              <div>
                <Row>
                  <Col xs="10">
                    <Container>
                      <Row>
                        <Col>
                          <div
                            className="large-graph-container center"
                            id="measure-series">
                            <MeasureGraph
                              title={`${this.props.match.params.measure} ${(this.state.normalized) ? 'per 1k hours' : ''}`}
                              seriesList={
                                (this.state.normalized) ?
                                normalizeSeries(this.state.seriesList, this.props.match.params.measure) :
                                this.state.seriesList
                              }
                              y={`${this.props.match.params.measure}`}
                              linked={true}
                              linked_format="%Y-%m-%d-%H-%M-%S" />
                          </div>
                        </Col>
                      </Row>
                      <Row>
                        <Col>
                          <div
                            className="large-graph-container center"
                            id="time-series">
                            <MeasureGraph
                              title="Usage khours"
                              seriesList={this.state.seriesList}
                              y={'usage_hours'}
                              linked={true}
                              linked_format="%Y-%m-%d-%H-%M-%S" />
                          </div>
                        </Col>
                      </Row>
                    </Container>
                  </Col>
                  <Col xs="2">
                    <FormGroup tag="fieldset">
                      <legend>Versions</legend>
                      {
                        this.props.measureData &&
                        _.map(this.props.measureData, (data, buildId) => ({
                          buildId,
                          version: data.version
                        })).sort((a, b) => a.buildId < b.buildId).map(version => (
                          <Label key={version.buildId} check>
                            <Input
                              name={version.buildId}
                              type="checkbox"
                              checked={!this.state.disabledBuildIds.has(version.buildId)}
                              onChange={this.versionCheckboxChanged} />
                            {' '}
                            {version.version}
                            <br />
                            <small>{version.buildId}</small>
                          </Label>))
                      }
                    </FormGroup>
                  </Col>
                </Row>
              </div>
            }
          </div>
        </div>
      </div>
    );
  }
}

const DetailView = connect(mapStateToProps)(DetailViewComponent);

export default DetailView;
