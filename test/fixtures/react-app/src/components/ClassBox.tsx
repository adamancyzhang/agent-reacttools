import { Component } from 'react';

interface ClassBoxState {
  message: string;
}

export default class ClassBox extends Component<object, ClassBoxState> {
  state: ClassBoxState = { message: 'class state message' };

  render() {
    return <div id="class-box">{this.state.message}</div>;
  }
}
